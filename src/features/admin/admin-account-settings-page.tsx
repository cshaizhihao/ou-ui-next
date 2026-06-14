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
    <ResponsivePage className="admin-account-cockpit space-y-3 md:space-y-4">
      <section className="stagger-1">
        <h3 className="text-base font-bold text-[#07111F] dark:text-white">{t.title}</h3>
        <p className="mt-1 text-xs text-[#35405A] dark:text-white/55">{t.subtitle}</p>
      </section>

      <WorkspaceCockpit aria-label={t.accountSettingsCockpit} className="account-safety-cockpit stagger-2">
        <div className="account-safety-shell-grid grid min-h-0 grid-cols-1 xl:grid-cols-[18rem_minmax(0,1fr)]">
          <aside
            aria-label={t.accountControlRail}
            className="account-safety-rail border-b border-[#07111F]/20 bg-[#EAF3D1]/72 p-3 dark:border-[#6B7CFF]/20 dark:bg-white/[0.02] xl:border-b-0 xl:border-r"
            role="complementary"
          >
            <div className="flex flex-col gap-3 xl:sticky xl:top-0">
              <div className="account-safety-identity-card border border-[#1E3AFF]/45 bg-[#FFFDF5]/82 p-3 shadow-[inset_0_-3px_0_#D9FF00] dark:border-[#6B7CFF]/28 dark:bg-white/[0.035]">
                <div className="mb-3 flex items-center gap-2">
                  <UserRound className="h-4 w-4 text-[#1E3AFF] dark:text-[#DDE3FF]" />
                  <h4 className="text-sm font-bold text-[#07111F] dark:text-white">{t.identity}</h4>
                </div>
                <div className="account-safety-identity-list grid grid-cols-1 gap-2">
                  <IdentityMetric icon={KeyRound} label={t.username} value={loginUsername} />
                  <IdentityMetric icon={ShieldCheck} label={t.operatorGroup} value={operatorGroupId} />
                  <IdentityMetric icon={ShieldCheck} label={t.resourceGroup} value={resourceGroupId} />
                  <IdentityMetric icon={RefreshCw} label={t.mode} value={controlPlaneMode} />
                </div>
              </div>

              <div className="account-safety-command-card border border-[#07111F] bg-[#FFFDF5]/82 p-3 dark:border-[#6B7CFF]/25 dark:bg-white/[0.035]">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <TerminalSquare className="h-4 w-4 text-[#1E3AFF] dark:text-[#DDE3FF]" />
                      <h4 className="text-sm font-bold text-[#07111F] dark:text-white">{t.resetTitle}</h4>
                    </div>
                    <p className="mt-2 break-words text-[11px] leading-5 text-[#35405A] dark:text-white/52">{t.resetHint}</p>
                  </div>
                  <span className="rounded-full border border-[#1E3AFF]/35 bg-[#DCE1FF] px-3 py-1 text-[10px] font-bold text-[#1E3AFF] dark:border-[#6B7CFF]/25 dark:bg-[#1E3AFF]/15 dark:text-[#DDE3FF]">
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

                <div className="mt-3 border border-[#07111F] bg-[#07111F] p-3 dark:border-[#6B7CFF]/25">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#D9FF00]">{t.commandLabel}</p>
                  <code className="block break-all font-mono text-xs font-semibold text-[#FDFFF1]">
                    {commandOptions[selectedCommand]}
                  </code>
                </div>
              </div>
            </div>
          </aside>

          <WorkspaceCockpitScroller aria-label={t.controlPlaneSafetyWorkspace} className="account-safety-workspace min-h-0">
            <div className="account-safety-dashboard-grid grid items-start gap-3 p-3 2xl:grid-cols-[minmax(0,1.3fr)_minmax(22rem,0.7fr)]">
              {controlPlaneBackupSummary && onCopyControlPlaneBackup ? (
                <GlassCard aria-label={t.backupTitle} className="account-safety-backup-panel p-3" role="group">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <DatabaseBackup className="h-4 w-4 text-[#1E3AFF] dark:text-[#DDE3FF]" />
                        <h4 className="text-sm font-bold text-[#07111F] dark:text-white">{t.backupTitle}</h4>
                      </div>
                      <p className="mt-2 max-w-3xl break-words text-xs text-[#35405A] dark:text-white/52">{t.backupHint}</p>
                    </div>
                    <GlowButton
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold"
                      onClick={onCopyControlPlaneBackup}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {t.copyControlPlaneBackup}
                    </GlowButton>
                  </div>

                  <div className="account-safety-compact-metrics-grid grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-2">
                    <BackupMetric label={t.backupInventory} value={controlPlaneBackupSummary.inventoryResources} />
                    <BackupMetric label={t.backupRuntimeArtifacts} value={controlPlaneBackupSummary.runtimeArtifacts} />
                    <BackupMetric label={t.backupFailedTasks} tone="signal" value={controlPlaneBackupSummary.failedTasks} />
                    <BackupMetric label={t.backupAuditLogs} value={controlPlaneBackupSummary.auditLogCount} />
                    <BackupMetric label={t.backupOperatorSessions} value={controlPlaneBackupSummary.operatorSessionCount} />
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                    <BackupEvidenceField
                      label={t.restoreCommand}
                      tone="command"
                      value="sudo ou-ui restore-control-plane-backup --stdin"
                    />
                    <BackupEvidenceField label={t.latestAuditHash} value={controlPlaneBackupSummary.latestAuditHash ?? 'n/a'} />
                  </div>

                  <p className="mt-3 break-words text-[11px] text-[#35405A] dark:text-white/52">{t.redactionHint}</p>

                  {onPreflightControlPlaneBackup ? (
                    <div className="mt-4 border border-[#1E3AFF]/35 bg-[#DCE1FF]/32 p-3 dark:border-[#6B7CFF]/24 dark:bg-[#1E3AFF]/[0.07]">
                      <div className="flex items-center gap-2">
                        <FileSearch className="h-4 w-4 text-[#1E3AFF] dark:text-[#DDE3FF]" />
                        <h5 className="text-sm font-bold text-[#07111F] dark:text-white">{t.restorePreflightTitle}</h5>
                      </div>
                      <p className="mt-2 break-words text-xs text-[#35405A] dark:text-white/52">{t.restorePreflightHint}</p>
                      <label className="mt-4 block text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/48">
                        {t.pasteControlPlaneBackup}
                        <textarea
                          className="mt-2 min-h-32 w-full resize-y border border-[#07111F]/20 bg-[#FFFDF5] p-3 font-mono text-xs text-[#07111F] outline-none transition focus:border-[#1E3AFF] focus:ring-2 focus:ring-[#1E3AFF]/20 dark:border-[#6B7CFF]/24 dark:bg-[#07111F]/70 dark:text-white/82 dark:focus:border-[#6B7CFF] dark:focus:ring-[#6B7CFF]/20"
                          onChange={(event) => setBackupRestoreText(event.target.value)}
                          placeholder={t.pasteControlPlaneBackupPlaceholder}
                          value={backupRestoreText}
                        />
                      </label>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <p className="text-[11px] text-[#35405A] dark:text-white/52">{t.dryRunOnly}</p>
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
                          className="account-safety-preflight-card mt-3 border border-[#FF3D18] bg-[#FFD8C6]/62 p-3 shadow-[inset_0_-3px_0_#D9FF00] dark:border-[#FF6A3A]/28 dark:bg-[#FF3D18]/[0.10]"
                        >
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <h6 className="text-sm font-bold text-[#07111F] dark:text-white">{t.restorePreflightResult}</h6>
                            <SessionPill
                              label={t.restorePreflightStatus[controlPlaneBackupPreflightResult.status]}
                              tone={controlPlaneBackupPreflightResult.status === 'ready' ? 'green' : controlPlaneBackupPreflightResult.status === 'warning' ? 'signal' : 'slate'}
                            />
                          </div>
                          <div className="account-safety-compact-metrics-grid grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-2">
                            <BackupMetric label={t.schema} value={controlPlaneBackupPreflightResult.schemaLabel} />
                            <BackupMetric label={t.backupInventory} value={controlPlaneBackupPreflightResult.inventoryResources} />
                            <BackupMetric label={t.backupRuntimeArtifacts} value={controlPlaneBackupPreflightResult.runtimeArtifacts} />
                            <BackupMetric label={t.backupAuditLogs} value={controlPlaneBackupPreflightResult.auditLogCount} />
                            <BackupMetric label={t.conflicts} tone="signal" value={controlPlaneBackupPreflightResult.conflictCount} />
                          </div>
                          <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-[#35405A] dark:text-white/62">
                            <p className="break-words">
                              {controlPlaneBackupPreflightResult.redactionPassed ? t.sensitiveRedacted : t.sensitiveFound}
                            </p>
                            {controlPlaneBackupPreflightResult.restoreCommand ? (
                              <code className="block break-all border border-[#07111F] bg-[#07111F] p-3 font-mono text-[#FDFFF1]">
                                {controlPlaneBackupPreflightResult.restoreCommand}
                              </code>
                            ) : null}
                            <p className="break-words">{t.dryRunOnly}</p>
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

              <GlassCard aria-label={t.sessions} className="account-safety-sessions-panel p-3" role="group">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <LogOut className="h-4 w-4 text-[#1E3AFF] dark:text-[#DDE3FF]" />
                      <h4 className="text-sm font-bold text-[#07111F] dark:text-white">{t.sessions}</h4>
                    </div>
                    <p className="mt-2 break-words text-xs text-[#35405A] dark:text-white/52">{t.sessionsHint}</p>
                  </div>
                </div>

                {operatorSessionsLoading ? (
                  <p className="text-xs text-[#35405A] dark:text-white/52">{t.sessionsLoading}</p>
                ) : operatorSessionsError ? (
                  <p className="text-xs text-red-600 dark:text-red-300">{operatorSessionsError}</p>
                ) : operatorSessions.length === 0 ? (
                  <div className="border border-dashed border-[#07111F]/25 p-3 text-xs text-[#35405A] dark:border-[#6B7CFF]/25 dark:text-white/52">
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
                          className="account-safety-session-row border border-[#07111F]/22 bg-[#FFFDF5]/76 p-3 transition-[border-color,background-color,transform] duration-200 ease-out hover:-translate-y-0.5 hover:border-[#1E3AFF] motion-reduce:transition-none dark:border-[#6B7CFF]/22 dark:bg-white/[0.035] dark:hover:border-[#6B7CFF]/38"
                          key={session.id}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="break-all text-sm font-bold text-[#07111F] dark:text-white">
                                {session.username}
                                <span className="text-[#35405A] dark:text-white/48"> {session.actor}</span>
                              </p>
                              <p className="mt-1 break-all font-mono text-[11px] text-[#35405A] dark:text-white/50">{session.id}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {isCurrentSession ? <SessionPill label={t.currentSession} tone="blue" /> : null}
                              <SessionPill label={t.status[session.status]} tone={session.status === 'active' ? 'green' : 'slate'} />
                            </div>
                          </div>

                          <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] text-[#35405A] dark:text-white/52">
                            <p className="account-safety-session-meta break-all">{t.sourceIp} {session.sourceIp}</p>
                            <p className="account-safety-session-meta break-words">
                              {t.issuedAt} {formatDateTime(session.issuedAt, language)} · {t.expiresAt}{' '}
                              {formatDateTime(session.expiresAt, language)}
                            </p>
                            <p className="account-safety-session-meta break-all">{t.requestId} {session.requestId}</p>
                            {session.userAgent ? (
                              <p className="account-safety-session-meta break-words">
                                {t.userAgent} {session.userAgent}
                              </p>
                            ) : null}
                          </div>

                          {onRevokeOperatorSession ? (
                            <div className="mt-3 flex justify-end">
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
      ? 'border-[#FF3D18]/45 bg-[#FFD8C6]/72 text-[#07111F] dark:border-[#FF6A3A]/30 dark:bg-[#FF3D18]/[0.12] dark:text-white/82'
      : 'border-[#1E3AFF]/24 bg-[#FFFDF5]/80 text-[#07111F] dark:border-[#6B7CFF]/22 dark:bg-white/[0.035] dark:text-white/78';
  const labelClass = tone === 'signal' ? 'text-[#C92810] dark:text-[#FFB299]' : 'text-[#35405A] dark:text-white/48';

  return (
    <div className={`account-safety-backup-metric min-w-0 border p-2.5 ${metricClass}`}>
      <span className="sr-only">{label} {value}</span>
      <p className={`break-words text-[10px] font-bold uppercase tracking-widest ${labelClass}`}>
        {label}
      </p>
      <p className="mt-2 break-all font-mono text-lg font-black text-current">{value}</p>
    </div>
  );
}

function BackupEvidenceField({
  label,
  tone = 'neutral',
  value
}: {
  label: string;
  tone?: 'command' | 'neutral';
  value: string;
}) {
  const fieldClass =
    tone === 'command'
      ? 'border-[#1E3AFF]/40 bg-[#DCE1FF]/58 text-[#07111F] dark:border-[#6B7CFF]/24 dark:bg-[#1E3AFF]/[0.10] dark:text-[#E7EBFF]'
      : 'border-[#00A878]/38 bg-[#D9FF00]/[0.20] text-[#07111F] dark:border-[#00A878]/28 dark:bg-[#00A878]/[0.11] dark:text-[#D8FFF0]';

  return (
    <div className={`account-safety-backup-field min-w-0 border p-3 ${fieldClass}`}>
      <p className="mb-2 break-words text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/48">
        {label}
      </p>
      <code className="block break-all font-mono text-xs font-semibold text-current">{value}</code>
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
    <div className="account-safety-identity-row min-w-0 border border-[#07111F]/18 bg-[#FFFDF5]/64 px-2.5 py-2 text-[#07111F] dark:border-[#6B7CFF]/22 dark:bg-white/[0.035] dark:text-white/78">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/48">
        <Icon className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="break-words">{label}</span>
      </div>
      <p className="mt-1 break-all font-mono text-xs font-bold text-current">{value}</p>
    </div>
  );
}

function CommandButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={
        active
          ? 'rounded-full border border-[#1E3AFF] bg-[#1E3AFF] px-4 py-2 text-xs font-bold text-white shadow-[0_8px_14px_-10px_rgba(30,58,255,0.5)] dark:border-[#6B7CFF] dark:bg-[#6B7CFF] dark:text-[#07111F]'
          : 'rounded-full border border-[#07111F]/20 bg-[#FFFDF5]/75 px-4 py-2 text-xs font-bold text-[#35405A] transition hover:border-[#1E3AFF] hover:text-[#1E3AFF] dark:border-[#6B7CFF]/20 dark:bg-white/[0.04] dark:text-white/55 dark:hover:text-[#DDE3FF]'
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
      ? 'border-[#1E3AFF]/35 bg-[#DCE1FF] text-[#1E3AFF] dark:border-[#6B7CFF]/25 dark:bg-[#1E3AFF]/15 dark:text-[#DDE3FF]'
      : tone === 'green'
        ? 'border-[#00A878]/35 bg-[#00A878]/[0.12] text-[#006B50] dark:border-[#00A878]/25 dark:bg-[#00A878]/[0.14] dark:text-[#7FF3C9]'
        : tone === 'signal'
          ? 'border-[#FF3D18]/45 bg-[#FFD8C6] text-[#C92810] dark:border-[#FF6A3A]/28 dark:bg-[#FF3D18]/[0.12] dark:text-[#FFB299]'
          : 'border-[#07111F]/18 bg-[#EAF3D1] text-[#35405A] dark:border-[#6B7CFF]/20 dark:bg-white/[0.06] dark:text-white/68';

  return <span className={`${className} rounded-full border px-3 py-1 text-[10px] font-bold uppercase`}>{label}</span>;
}
