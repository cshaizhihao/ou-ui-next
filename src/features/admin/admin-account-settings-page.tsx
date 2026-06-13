import { useMemo, useState } from 'react';
import {
  Copy,
  DatabaseBackup,
  FileSearch,
  KeyRound,
  LogOut,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  UserRound
} from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { ResponsivePage, WorkspaceCockpit, WorkspaceCockpitScroller } from '../../components/layout/responsive-page';
import { GlassCard } from '../../components/ui/glass-card';
import { GlowButton } from '../../components/ui/glow-button';
import type { OperatorSessionSummary } from '../../domain';
import { formatDateTime } from '../shared/format';

export type ControlPlaneBackupSummary = {
  inventoryResources: number;
  runtimeArtifacts: number;
  failedTasks: number;
  auditLogCount: number;
  latestAuditHash?: string;
  operatorSessionCount: number;
};

export type ControlPlaneBackupPreflightResult = {
  status: 'ready' | 'warning' | 'invalid';
  schemaLabel: string;
  inventoryResources: number;
  runtimeArtifacts: number;
  auditLogCount: number;
  conflictCount: number;
  conflictPreview: string[];
  redactionPassed: boolean;
  restoreCommand?: string;
  notes: string[];
};

type AdminAccountSettingsPageProps = {
  controlPlaneBackupSummary?: ControlPlaneBackupSummary;
  controlPlaneBackupPreflightResult?: ControlPlaneBackupPreflightResult;
  controlPlaneMode: 'mock' | 'http';
  currentOperatorSessionId?: string;
  language: AppLanguage;
  loginUsername: string;
  operatorGroupId: string;
  operatorSessions?: OperatorSessionSummary[];
  operatorSessionsError?: string;
  operatorSessionsLoading?: boolean;
  resourceGroupId: string;
  taskMutationBusy?: boolean;
  onCopyControlPlaneBackup?: () => void;
  onPreflightControlPlaneBackup?: (backupText: string) => void;
  onRevokeOperatorSession?: (sessionId: string) => void;
};

const copy = {
  zh: {
    title: '管理员账户设置',
    subtitle: '集中查看当前控制面登录身份、凭据轮换命令和服务端操作员会话。',
    identity: '当前登录身份',
    username: '登录账号',
    operatorGroup: '操作员组',
    resourceGroup: '资源组',
    mode: '控制面模式',
    resetTitle: '登录凭据重置',
    resetHint:
      '面板不会在浏览器内保存或展示新密码。登录账号和密码由服务器管理命令轮换，命令会更新后端 password hash 并让旧浏览器会话失效。',
    rotateCommand: '重置账号密码',
    credentialsCommand: '查看当前凭据',
    commandLabel: '服务器命令',
    backupTitle: '控制面备份',
    backupHint:
      '复制当前控制面库存、运行时证据、审计链摘要和已脱敏安全上下文，用于迁移前留档或恢复前核对。',
    copyControlPlaneBackup: '复制控制面备份包',
    restorePreflightTitle: '恢复预检',
    restorePreflightHint: '粘贴控制面备份 JSON，先做结构、脱敏、审计锚点和资源冲突检查；此操作不会写入数据库。',
    pasteControlPlaneBackup: '粘贴控制面备份包',
    pasteControlPlaneBackupPlaceholder: '粘贴 ou-ui-next.control-plane.backup JSON',
    runRestorePreflight: '运行恢复预检',
    restorePreflightResult: '恢复预检结果',
    restorePreflightStatus: {
      ready: '可以恢复',
      warning: '需要人工确认',
      invalid: '无法恢复'
    },
    schema: 'Schema',
    conflicts: '资源冲突',
    sensitiveRedacted: '敏感信息已脱敏',
    sensitiveFound: '发现疑似敏感信息',
    dryRunOnly: '仅预检，未执行恢复',
    backupInventory: '库存资源',
    backupRuntimeArtifacts: '运行时证据',
    backupFailedTasks: '失败记录',
    backupAuditLogs: '审计日志',
    backupOperatorSessions: '操作员会话',
    latestAuditHash: '最新审计哈希',
    restoreCommand: '恢复命令',
    redactionHint: '敏感令牌只保留状态或前缀，不包含登录密码、Telegram token 或 Agent token hash。',
    sessions: '操作员会话',
    sessionsHint: '撤销活跃会话会写入审计证据；撤销当前会话后需要重新登录。',
    sessionsLoading: '正在读取会话列表',
    sessionsEmpty: '当前没有可管理的操作员会话。',
    currentSession: '当前会话',
    revokeSession: '撤销会话',
    revokeCurrentSession: '撤销并退出',
    confirmRevokeSession: (sessionId: string) => `确认撤销操作员会话 ${sessionId}？`,
    status: {
      active: '活跃',
      revoked: '已撤销',
      expired: '已过期'
    },
    issuedAt: '签发',
    expiresAt: '到期',
    sourceIp: '来源',
    requestId: '请求',
    userAgent: '客户端',
    accountSettingsCockpit: '账户设置 cockpit',
    accountControlRail: '账户控制轨',
    controlPlaneSafetyWorkspace: '控制面安全工作区'
  },
  en: {
    title: 'Admin Accounts',
    subtitle: 'Review the current control-plane login identity, credential rotation command, and operator sessions.',
    identity: 'Current Login Identity',
    username: 'Username',
    operatorGroup: 'Operator Group',
    resourceGroup: 'Resource Group',
    mode: 'Control-plane Mode',
    resetTitle: 'Login Credential Reset',
    resetHint:
      'The browser does not store or reveal newly generated passwords. Rotate login credentials on the server; the command updates the backend password hash and invalidates old browser sessions.',
    rotateCommand: 'Reset Username and Password',
    credentialsCommand: 'Show Current Credentials',
    commandLabel: 'Server Command',
    backupTitle: 'Control-plane Backup',
    backupHint:
      'Copy the current control-plane inventory, runtime evidence, audit chain summary, and redacted security context for migration review or restore checks.',
    copyControlPlaneBackup: 'Copy Control-plane Backup Package',
    restorePreflightTitle: 'Restore Preflight',
    restorePreflightHint: 'Paste a control-plane backup JSON to check structure, redaction, audit anchors, and resource conflicts before any database write.',
    pasteControlPlaneBackup: 'Paste Control-plane Backup Package',
    pasteControlPlaneBackupPlaceholder: 'Paste ou-ui-next.control-plane.backup JSON',
    runRestorePreflight: 'Run Restore Preflight',
    restorePreflightResult: 'Restore Preflight Result',
    restorePreflightStatus: {
      ready: 'Ready to Restore',
      warning: 'Needs Manual Review',
      invalid: 'Cannot Restore'
    },
    schema: 'Schema',
    conflicts: 'Resource Conflicts',
    sensitiveRedacted: 'Sensitive Data Redacted',
    sensitiveFound: 'Potential Sensitive Data Found',
    dryRunOnly: 'Dry-run only, no restore executed',
    backupInventory: 'Inventory Resources',
    backupRuntimeArtifacts: 'Runtime Evidence',
    backupFailedTasks: 'Failed Tasks',
    backupAuditLogs: 'Audit Logs',
    backupOperatorSessions: 'Operator Sessions',
    latestAuditHash: 'Latest Audit Hash',
    restoreCommand: 'Restore Command',
    redactionHint: 'Sensitive tokens keep only state or prefixes; login passwords, Telegram tokens, and Agent token hashes are excluded.',
    sessions: 'Operator Sessions',
    sessionsHint: 'Revoking active sessions writes audit evidence. Revoking the current session requires signing in again.',
    sessionsLoading: 'Loading operator sessions',
    sessionsEmpty: 'No operator sessions are available.',
    currentSession: 'Current Session',
    revokeSession: 'Revoke Session',
    revokeCurrentSession: 'Revoke and Sign Out',
    confirmRevokeSession: (sessionId: string) => `Revoke operator session ${sessionId}?`,
    status: {
      active: 'Active',
      revoked: 'Revoked',
      expired: 'Expired'
    },
    issuedAt: 'Issued',
    expiresAt: 'Expires',
    sourceIp: 'Source',
    requestId: 'Request',
    userAgent: 'Client',
    accountSettingsCockpit: 'Account settings cockpit',
    accountControlRail: 'Account control rail',
    controlPlaneSafetyWorkspace: 'Control-plane safety workspace'
  }
} as const;

const commandOptions = {
  rotate: 'sudo ou-ui rotate-credentials',
  credentials: 'sudo ou-ui credentials'
} as const;

export function AdminAccountSettingsPage({
  controlPlaneBackupSummary,
  controlPlaneBackupPreflightResult,
  controlPlaneMode,
  currentOperatorSessionId,
  language,
  loginUsername,
  operatorGroupId,
  operatorSessions = [],
  operatorSessionsError,
  operatorSessionsLoading = false,
  resourceGroupId,
  taskMutationBusy = false,
  onCopyControlPlaneBackup,
  onPreflightControlPlaneBackup,
  onRevokeOperatorSession
}: AdminAccountSettingsPageProps) {
  const t = copy[language];
  const [selectedCommand, setSelectedCommand] = useState<keyof typeof commandOptions>('rotate');
  const [backupRestoreText, setBackupRestoreText] = useState('');
  const activeSessions = useMemo(
    () => operatorSessions.filter((session) => session.status === 'active').length,
    [operatorSessions]
  );

  function revokeOperatorSession(sessionId: string) {
    const confirmed = typeof window === 'undefined' || window.confirm(t.confirmRevokeSession(sessionId));

    if (!confirmed) {
      return;
    }

    onRevokeOperatorSession?.(sessionId);
  }

  return (
    <ResponsivePage className="admin-account-cockpit space-y-5 md:space-y-6">
      <section className="stagger-1">
        <h3 className="text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-white/50">{t.subtitle}</p>
      </section>

      <WorkspaceCockpit aria-label={t.accountSettingsCockpit} className="account-safety-cockpit stagger-2">
        <div className="grid min-h-0 grid-cols-1 xl:grid-cols-[21rem_minmax(0,1fr)]">
          <aside
            aria-label={t.accountControlRail}
            className="account-safety-rail border-b border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.02] xl:border-b-0 xl:border-r"
            role="complementary"
          >
            <div className="flex flex-col gap-4 xl:sticky xl:top-0">
              <div className="rounded-xl border border-slate-200 bg-white/75 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="mb-4 flex items-center gap-2">
                  <UserRound className="h-4 w-4 text-blue-500 dark:text-primary" />
                  <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.identity}</h4>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <IdentityMetric icon={KeyRound} label={t.username} value={loginUsername} />
                  <IdentityMetric icon={ShieldCheck} label={t.operatorGroup} value={operatorGroupId} />
                  <IdentityMetric icon={ShieldCheck} label={t.resourceGroup} value={resourceGroupId} />
                  <IdentityMetric icon={RefreshCw} label={t.mode} value={controlPlaneMode} />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white/75 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <TerminalSquare className="h-4 w-4 text-blue-500 dark:text-primary" />
                      <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.resetTitle}</h4>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-white/45">{t.resetHint}</p>
                  </div>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-bold text-blue-600 dark:bg-primary/15 dark:text-primary">
                    {activeSessions}/{operatorSessions.length}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <CommandButton
                    active={selectedCommand === 'rotate'}
                    label={t.rotateCommand}
                    onClick={() => setSelectedCommand('rotate')}
                  />
                  <CommandButton
                    active={selectedCommand === 'credentials'}
                    label={t.credentialsCommand}
                    onClick={() => setSelectedCommand('credentials')}
                  />
                </div>

                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-950 p-4 dark:border-white/10">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/40">{t.commandLabel}</p>
                  <code className="block break-all font-mono text-xs font-semibold text-emerald-300">
                    {commandOptions[selectedCommand]}
                  </code>
                </div>
              </div>
            </div>
          </aside>

          <WorkspaceCockpitScroller aria-label={t.controlPlaneSafetyWorkspace} className="account-safety-workspace min-h-0">
            <div className="space-y-4 p-4">
              {controlPlaneBackupSummary && onCopyControlPlaneBackup ? (
                <GlassCard aria-label={t.backupTitle} className="account-safety-backup-panel p-5" role="group">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <DatabaseBackup className="h-4 w-4 text-blue-500 dark:text-primary" />
                        <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.backupTitle}</h4>
                      </div>
                      <p className="mt-2 max-w-3xl text-xs text-slate-500 dark:text-white/45">{t.backupHint}</p>
                    </div>
                    <GlowButton
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold"
                      onClick={onCopyControlPlaneBackup}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {t.copyControlPlaneBackup}
                    </GlowButton>
                  </div>

                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                    <BackupMetric label={t.backupInventory} value={controlPlaneBackupSummary.inventoryResources} />
                    <BackupMetric label={t.backupRuntimeArtifacts} value={controlPlaneBackupSummary.runtimeArtifacts} />
                    <BackupMetric label={t.backupFailedTasks} tone="signal" value={controlPlaneBackupSummary.failedTasks} />
                    <BackupMetric label={t.backupAuditLogs} value={controlPlaneBackupSummary.auditLogCount} />
                    <BackupMetric label={t.backupOperatorSessions} value={controlPlaneBackupSummary.operatorSessionCount} />
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                        {t.restoreCommand}
                      </p>
                      <code className="block break-all font-mono text-xs font-semibold text-slate-800 dark:text-emerald-300">
                        sudo ou-ui restore-control-plane-backup --stdin
                      </code>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                        {t.latestAuditHash}
                      </p>
                      <code className="block break-all font-mono text-xs font-semibold text-slate-800 dark:text-white/75">
                        {controlPlaneBackupSummary.latestAuditHash ?? 'n/a'}
                      </code>
                    </div>
                  </div>

                  <p className="mt-3 text-[11px] text-slate-500 dark:text-white/45">{t.redactionHint}</p>

                  {onPreflightControlPlaneBackup ? (
                    <div className="mt-5 rounded-lg border border-slate-200 p-4 dark:border-white/10">
                      <div className="flex items-center gap-2">
                        <FileSearch className="h-4 w-4 text-blue-500 dark:text-primary" />
                        <h5 className="text-sm font-bold text-slate-800 dark:text-white">{t.restorePreflightTitle}</h5>
                      </div>
                      <p className="mt-2 text-xs text-slate-500 dark:text-white/45">{t.restorePreflightHint}</p>
                      <label className="mt-4 block text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                        {t.pasteControlPlaneBackup}
                        <textarea
                          className="mt-2 min-h-32 w-full resize-y rounded-lg border border-slate-200 bg-white/80 p-3 font-mono text-xs text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-200 dark:border-white/10 dark:bg-slate-950/60 dark:text-white/75 dark:focus:border-primary dark:focus:ring-primary/20"
                          onChange={(event) => setBackupRestoreText(event.target.value)}
                          placeholder={t.pasteControlPlaneBackupPlaceholder}
                          value={backupRestoreText}
                        />
                      </label>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <p className="text-[11px] text-slate-500 dark:text-white/45">{t.dryRunOnly}</p>
                        <GlowButton
                          className="px-4 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={backupRestoreText.trim().length === 0}
                          onClick={() => onPreflightControlPlaneBackup(backupRestoreText)}
                        >
                          {t.runRestorePreflight}
                        </GlowButton>
                      </div>

                      {controlPlaneBackupPreflightResult ? (
                        <section
                          aria-label={t.restorePreflightResult}
                          className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5"
                        >
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <h6 className="text-sm font-bold text-slate-800 dark:text-white">{t.restorePreflightResult}</h6>
                            <SessionPill
                              label={t.restorePreflightStatus[controlPlaneBackupPreflightResult.status]}
                              tone={controlPlaneBackupPreflightResult.status === 'ready' ? 'green' : controlPlaneBackupPreflightResult.status === 'warning' ? 'signal' : 'slate'}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                            <BackupMetric label={t.schema} value={controlPlaneBackupPreflightResult.schemaLabel} />
                            <BackupMetric label={t.backupInventory} value={controlPlaneBackupPreflightResult.inventoryResources} />
                            <BackupMetric label={t.backupRuntimeArtifacts} value={controlPlaneBackupPreflightResult.runtimeArtifacts} />
                            <BackupMetric label={t.backupAuditLogs} value={controlPlaneBackupPreflightResult.auditLogCount} />
                            <BackupMetric label={t.conflicts} tone="signal" value={controlPlaneBackupPreflightResult.conflictCount} />
                          </div>
                          <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-600 dark:text-white/60">
                            <p>{controlPlaneBackupPreflightResult.redactionPassed ? t.sensitiveRedacted : t.sensitiveFound}</p>
                            {controlPlaneBackupPreflightResult.restoreCommand ? (
                              <code className="block break-all rounded-lg bg-slate-950 p-3 font-mono text-emerald-300">
                                {controlPlaneBackupPreflightResult.restoreCommand}
                              </code>
                            ) : null}
                            <p>{t.dryRunOnly}</p>
                            {controlPlaneBackupPreflightResult.conflictPreview.length > 0 ? (
                              <ul className="space-y-1">
                                {controlPlaneBackupPreflightResult.conflictPreview.map((conflict) => (
                                  <li key={conflict} className="break-all font-mono text-[11px]">
                                    {conflict}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                            {controlPlaneBackupPreflightResult.notes.map((note) => (
                              <p key={note} className="break-words text-[11px]">
                                {note}
                              </p>
                            ))}
                          </div>
                        </section>
                      ) : null}
                    </div>
                  ) : null}
                </GlassCard>
              ) : null}

              <GlassCard aria-label={t.sessions} className="account-safety-sessions-panel p-5" role="group">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <LogOut className="h-4 w-4 text-blue-500 dark:text-primary" />
                      <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.sessions}</h4>
                    </div>
                    <p className="mt-2 text-xs text-slate-500 dark:text-white/45">{t.sessionsHint}</p>
                  </div>
                </div>

                {operatorSessionsLoading ? (
                  <p className="text-xs text-slate-500 dark:text-white/45">{t.sessionsLoading}</p>
                ) : operatorSessionsError ? (
                  <p className="text-xs text-red-600 dark:text-red-300">{operatorSessionsError}</p>
                ) : operatorSessions.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 p-4 text-xs text-slate-500 dark:border-white/10 dark:text-white/45">
                    {t.sessionsEmpty}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    {operatorSessions.map((session) => {
                      const isCurrentSession = session.id === currentOperatorSessionId;
                      const disabled = session.status !== 'active' || taskMutationBusy || !onRevokeOperatorSession;

                      return (
                        <article
                          aria-label={`${session.username} ${session.actor}`}
                          className="account-safety-session-row rounded-lg border border-slate-200 p-4 dark:border-white/10"
                          key={session.id}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="break-all text-sm font-bold text-slate-900 dark:text-white">
                                {session.username}
                                <span className="text-slate-500 dark:text-white/45"> · {session.actor}</span>
                              </p>
                              <p className="mt-1 break-all font-mono text-[11px] text-slate-500 dark:text-white/45">{session.id}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {isCurrentSession ? <SessionPill label={t.currentSession} tone="blue" /> : null}
                              <SessionPill label={t.status[session.status]} tone={session.status === 'active' ? 'green' : 'slate'} />
                            </div>
                          </div>

                          <div className="mt-4 grid grid-cols-1 gap-2 text-[11px] text-slate-500 dark:text-white/45">
                            <p className="break-all">{t.sourceIp} {session.sourceIp}</p>
                            <p className="break-all">
                              {t.issuedAt} {formatDateTime(session.issuedAt, language)} · {t.expiresAt}{' '}
                              {formatDateTime(session.expiresAt, language)}
                            </p>
                            <p className="break-all">{t.requestId} {session.requestId}</p>
                            {session.userAgent ? <p className="break-all">{t.userAgent} {session.userAgent}</p> : null}
                          </div>

                          {onRevokeOperatorSession ? (
                            <div className="mt-4 flex justify-end">
                              <GlowButton
                                className="px-4 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={disabled}
                                onClick={() => revokeOperatorSession(session.id)}
                              >
                                {isCurrentSession ? t.revokeCurrentSession : t.revokeSession}
                              </GlowButton>
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                )}
              </GlassCard>
            </div>
          </WorkspaceCockpitScroller>
        </div>
      </WorkspaceCockpit>
    </ResponsivePage>
  );
}

function BackupMetric({ label, tone, value }: { label: string; tone?: 'signal'; value: number | string }) {
  const metricClass =
    tone === 'signal'
      ? 'border-orange-200 bg-orange-50/65 dark:border-orange-300/20 dark:bg-orange-400/[0.08]'
      : 'border-slate-200 dark:border-white/10';
  const labelClass = tone === 'signal' ? 'text-orange-700 dark:text-orange-200' : 'text-slate-500 dark:text-white/40';

  return (
    <div className={`min-w-0 rounded-lg border p-3 ${metricClass}`}>
      <span className="sr-only">{label} {value}</span>
      <p className={`truncate text-[10px] font-bold uppercase tracking-widest ${labelClass}`}>
        {label}
      </p>
      <p className="mt-2 break-all font-mono text-lg font-black text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}

function IdentityMetric({
  icon: Icon,
  label,
  value
}: {
  icon: typeof KeyRound;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 p-3 dark:border-white/10">
      <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
        <Icon className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <p className="truncate font-mono text-sm font-bold text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}

function CommandButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={
        active
          ? 'rounded-lg bg-blue-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-blue-500/20 dark:bg-primary dark:text-slate-950'
          : 'rounded-lg border border-slate-200 bg-white/60 px-4 py-2 text-xs font-bold text-slate-500 transition hover:text-blue-600 dark:border-white/10 dark:bg-white/5 dark:text-white/50 dark:hover:text-primary'
      }
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function SessionPill({ label, tone }: { label: string; tone: 'blue' | 'green' | 'signal' | 'slate' }) {
  const className =
    tone === 'blue'
      ? 'bg-blue-50 text-blue-600 dark:bg-primary/15 dark:text-primary'
      : tone === 'green'
        ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300'
        : tone === 'signal'
          ? 'bg-orange-50 text-orange-700 dark:bg-orange-400/10 dark:text-orange-200'
          : 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/70';

  return <span className={`${className} rounded-full px-3 py-1 text-[10px] font-bold uppercase`}>{label}</span>;
}
