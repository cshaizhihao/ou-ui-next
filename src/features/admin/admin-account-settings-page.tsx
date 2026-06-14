import { Fragment, useMemo, useState } from 'react';
import {
  Ban,
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
import type { AgentCredentialSummary, AgentSessionSummary, OperatorSessionSummary } from '../../domain';
import { formatDateTime, formatNumber } from '../shared/format';

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
  agentCredentials?: AgentCredentialSummary[];
  agentSessions?: AgentSessionSummary[];
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
  onRevokeAgentCredential?: (credentialId: string) => void;
  onRevokeOperatorSession?: (sessionId: string) => void;
  onRotateAgentCredential?: (credentialId: string) => void;
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
    agentCredentialsTitle: 'Agent 运行凭证',
    agentCredentialsEmpty: '当前没有 Agent 凭证记录。',
    agentCredentialColumns: {
      identity: '凭证',
      token: '令牌摘要',
      lifecycle: '生命周期',
      session: '会话',
      audit: '审计',
      action: '操作'
    },
    agentCredentialPurpose: {
      install: '安装凭证',
      runtime: '运行凭证'
    },
    agentCredentialStatus: {
      active: '活跃',
      revoked: '已撤销',
      expired: '已过期'
    },
    tokenPrefix: '令牌前缀',
    credentialIssuedAt: '签发',
    credentialExpiresAt: '到期',
    credentialLastUsedAt: '最近使用',
    credentialRequestId: '请求',
    credentialSource: '来源',
    credentialIssuedBy: '签发者',
    credentialSession: '会话',
    credentialNoSession: '未绑定',
    agentSessionStatus: {
      online: '在线',
      degraded: '降级',
      offline: '离线'
    },
    agentSessionLastSeq: '事件 seq',
    agentSessionLastCommandSeq: '命令 seq',
    agentSessionUpdatedAt: '最近活动',
    agentSessionHeartbeatAt: '心跳',
    agentSessionVersion: 'Agent 版本',
    agentSessionCapabilities: '能力',
    agentSessionMissing: '暂无 session 进度',
    credentialReplacedBy: '替换为',
    credentialRevokedMeta: (reason: string, actor: string) => `撤销原因：${reason}，执行者：${actor}`,
    revokeCredential: '撤销凭证',
    rotateCredential: '轮换凭证',
    confirmCredentialOperation: (action: string, credentialId: string) => `确认${action} ${credentialId}？`,
    credentialOperationPreflight: 'Agent 凭证操作预检',
    credentialImpactAgent: '绑定 Agent',
    credentialImpactSession: '绑定会话',
    credentialImpactCapabilities: '能力',
    credentialImpactTokenPrefix: '令牌前缀',
    credentialImpactRequest: '请求证据',
    credentialImpactCapabilityPreview: '能力预览',
    credentialImpactLifecyclePreview: '生命周期预览',
    credentialImpactAuditPreview: '审计预览',
    credentialImpactNoCapabilities: '暂无能力',
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
    agentCredentialsTitle: 'Agent Runtime Credentials',
    agentCredentialsEmpty: 'No Agent credentials are available.',
    agentCredentialColumns: {
      identity: 'Credential',
      token: 'Token Summary',
      lifecycle: 'Lifecycle',
      session: 'Session',
      audit: 'Audit',
      action: 'Action'
    },
    agentCredentialPurpose: {
      install: 'Install Credential',
      runtime: 'Runtime Credential'
    },
    agentCredentialStatus: {
      active: 'Active',
      revoked: 'Revoked',
      expired: 'Expired'
    },
    tokenPrefix: 'Token Prefix',
    credentialIssuedAt: 'Issued',
    credentialExpiresAt: 'Expires',
    credentialLastUsedAt: 'Last used',
    credentialRequestId: 'Request',
    credentialSource: 'Source',
    credentialIssuedBy: 'Issued by',
    credentialSession: 'Session',
    credentialNoSession: 'Unbound',
    agentSessionStatus: {
      online: 'Online',
      degraded: 'Degraded',
      offline: 'Offline'
    },
    agentSessionLastSeq: 'Event seq',
    agentSessionLastCommandSeq: 'Command seq',
    agentSessionUpdatedAt: 'Updated',
    agentSessionHeartbeatAt: 'Heartbeat',
    agentSessionVersion: 'Agent Version',
    agentSessionCapabilities: 'Capabilities',
    agentSessionMissing: 'No session progress',
    credentialReplacedBy: 'Replaced by',
    credentialRevokedMeta: (reason: string, actor: string) => `Revocation reason: ${reason}, actor: ${actor}`,
    revokeCredential: 'Revoke Credential',
    rotateCredential: 'Rotate Credential',
    confirmCredentialOperation: (action: string, credentialId: string) => `${action} ${credentialId}?`,
    credentialOperationPreflight: 'Agent Credential Operation Preflight',
    credentialImpactAgent: 'Bound Agent',
    credentialImpactSession: 'Bound Session',
    credentialImpactCapabilities: 'Capabilities',
    credentialImpactTokenPrefix: 'Token Prefix',
    credentialImpactRequest: 'Request Evidence',
    credentialImpactCapabilityPreview: 'Capability Preview',
    credentialImpactLifecyclePreview: 'Lifecycle Preview',
    credentialImpactAuditPreview: 'Audit Preview',
    credentialImpactNoCapabilities: 'No capabilities',
    accountSettingsCockpit: 'Account settings cockpit',
    accountControlRail: 'Account control rail',
    controlPlaneSafetyWorkspace: 'Control-plane safety workspace'
  }
} as const;

const commandOptions = {
  rotate: 'sudo ou-ui rotate-credentials',
  credentials: 'sudo ou-ui credentials'
} as const;

type AdminAccountSettingsCopy = (typeof copy)[AppLanguage];

type AgentCredentialOperationImpactSummary = {
  auditLabels: string[];
  capabilityLabels: string[];
  lifecycleLabels: string[];
  sessionLabel: string;
};

export function AdminAccountSettingsPage({
  agentCredentials = [],
  agentSessions = [],
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
  onRevokeAgentCredential,
  onRevokeOperatorSession,
  onRotateAgentCredential
}: AdminAccountSettingsPageProps) {
  const t = copy[language];
  const [selectedCommand, setSelectedCommand] = useState<keyof typeof commandOptions>('rotate');
  const [backupRestoreText, setBackupRestoreText] = useState('');
  const activeSessions = useMemo(
    () => operatorSessions.filter((session) => session.status === 'active').length,
    [operatorSessions]
  );
  const activeAgentCredentials = useMemo(
    () => agentCredentials.filter((credential) => credential.status === 'active').length,
    [agentCredentials]
  );
  const visibleAgentCredentials = useMemo(
    () => [...agentCredentials].sort(compareAgentCredentials),
    [agentCredentials]
  );
  const agentSessionByKey = useMemo(() => {
    const entries = agentSessions.map((session) => [createAgentSessionKey(session.agentId, session.sessionId), session] as const);
    return new Map(entries);
  }, [agentSessions]);

  function revokeOperatorSession(sessionId: string) {
    const confirmed = typeof window === 'undefined' || window.confirm(t.confirmRevokeSession(sessionId));

    if (!confirmed) {
      return;
    }

    onRevokeOperatorSession?.(sessionId);
  }

  function runAgentCredentialOperation(action: 'rotate' | 'revoke', credentialId: string) {
    const actionLabel = action === 'rotate' ? t.rotateCredential : t.revokeCredential;
    const confirmed = typeof window === 'undefined' || window.confirm(t.confirmCredentialOperation(actionLabel, credentialId));

    if (!confirmed) {
      return;
    }

    if (action === 'rotate') {
      onRotateAgentCredential?.(credentialId);
      return;
    }

    onRevokeAgentCredential?.(credentialId);
  }

  return (
    <ResponsivePage className="admin-account-cockpit space-y-3 md:space-y-4">
      <section className="stagger-1">
        <h3 className="text-base font-bold text-[#07111F] dark:text-white">{t.title}</h3>
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

                  {onPreflightControlPlaneBackup ? (
                    <div className="mt-4 border border-[#1E3AFF]/35 bg-[#DCE1FF]/32 p-3 dark:border-[#6B7CFF]/24 dark:bg-[#1E3AFF]/[0.07]">
                      <div className="flex items-center gap-2">
                        <FileSearch className="h-4 w-4 text-[#1E3AFF] dark:text-[#DDE3FF]" />
                        <h5 className="text-sm font-bold text-[#07111F] dark:text-white">{t.restorePreflightTitle}</h5>
                      </div>
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

              <GlassCard aria-label={t.agentCredentialsTitle} className="account-safety-credentials-panel p-3" role="group">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-[#1E3AFF] dark:text-[#DDE3FF]" />
                    <h4 className="text-sm font-bold text-[#07111F] dark:text-white">{t.agentCredentialsTitle}</h4>
                  </div>
                  <span className="rounded-full border border-[#1E3AFF]/35 bg-[#DCE1FF] px-3 py-1 text-[10px] font-bold text-[#1E3AFF] dark:border-[#6B7CFF]/25 dark:bg-[#1E3AFF]/15 dark:text-[#DDE3FF]">
                    {activeAgentCredentials}/{agentCredentials.length}
                  </span>
                </div>

                {visibleAgentCredentials.length === 0 ? (
                  <div className="border border-dashed border-[#07111F]/25 p-3 text-xs text-[#35405A] dark:border-[#6B7CFF]/25 dark:text-white/52">
                    {t.agentCredentialsEmpty}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1120px] text-left">
                      <thead className="text-[11px] uppercase tracking-[0.18em] text-[#35405A] dark:text-white/48">
                        <tr>
                          <th className="px-4 py-3">{t.agentCredentialColumns.identity}</th>
                          <th className="px-4 py-3">{t.agentCredentialColumns.token}</th>
                          <th className="px-4 py-3">{t.agentCredentialColumns.lifecycle}</th>
                          <th className="px-4 py-3">{t.agentCredentialColumns.session}</th>
                          <th className="px-4 py-3">{t.agentCredentialColumns.audit}</th>
                          <th className="px-4 py-3">{t.agentCredentialColumns.action}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#07111F]/12 text-sm text-[#35405A] dark:divide-[#6B7CFF]/18 dark:text-white/75">
                        {visibleAgentCredentials.map((credential) => {
                          const canRevoke = credential.status === 'active' && Boolean(onRevokeAgentCredential);
                          const canRotate =
                            credential.status === 'active' &&
                            credential.purpose === 'runtime' &&
                            Boolean(onRotateAgentCredential);
                          const showOperationPreflight = canRevoke || canRotate;
                          const boundSession = credential.sessionId
                            ? agentSessionByKey.get(createAgentSessionKey(credential.agentId, credential.sessionId))
                            : undefined;

                          return (
                            <Fragment key={credential.id}>
                              <tr className="account-safety-credential-row">
                                <td className="px-4 py-4 align-top">
                                  <div className="min-w-0">
                                    <p className="break-all font-semibold text-[#07111F] dark:text-white">{credential.agentId}</p>
                                    <p className="mt-1 break-all font-mono text-[11px] text-[#35405A] dark:text-white/50">
                                      {credential.id}
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      <SessionPill label={t.agentCredentialPurpose[credential.purpose]} tone="slate" />
                                      <span className={agentCredentialStatusClassName(credential.status)}>
                                        {t.agentCredentialStatus[credential.status]}
                                      </span>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-4 align-top text-xs text-[#35405A] dark:text-white/52">
                                  <div className="space-y-2">
                                    <p className="break-all font-mono">
                                      {t.tokenPrefix} {credential.tokenPrefix}
                                    </p>
                                    <p className="break-all">
                                      {t.credentialIssuedBy} {credential.issuedBy}
                                    </p>
                                    <p className="break-all">
                                      {t.credentialSource} {credential.sourceIp}
                                    </p>
                                  </div>
                                </td>
                                <td className="px-4 py-4 align-top text-xs text-[#35405A] dark:text-white/52">
                                  <div className="space-y-2">
                                    <p>
                                      {t.credentialIssuedAt} {formatDateTime(credential.issuedAt, language)}
                                    </p>
                                    <p>
                                      {t.credentialExpiresAt} {formatDateTime(credential.expiresAt, language)}
                                    </p>
                                    <p>
                                      {t.credentialLastUsedAt}{' '}
                                      {credential.lastUsedAt ? formatDateTime(credential.lastUsedAt, language) : '-'}
                                    </p>
                                    {credential.revokedAt ? (
                                      <p>
                                        {formatDateTime(credential.revokedAt, language)}{' '}
                                        {t.credentialRevokedMeta(credential.revokedReason ?? '-', credential.revokedBy ?? '-')}
                                      </p>
                                    ) : null}
                                  </div>
                                </td>
                                <td className="px-4 py-4 align-top text-xs text-[#35405A] dark:text-white/52">
                                  <div className="space-y-2">
                                    <p className="break-all">
                                      {t.credentialSession} {credential.sessionId ?? t.credentialNoSession}
                                    </p>
                                    {boundSession ? (
                                      <div className="space-y-1 border border-[#07111F]/18 bg-[#FFFDF5]/70 p-2.5 dark:border-[#6B7CFF]/20 dark:bg-white/[0.04]">
                                        <p>
                                          <span className={agentSessionStatusClassName(boundSession.status)}>
                                            {t.agentSessionStatus[boundSession.status]}
                                          </span>
                                        </p>
                                        <p>
                                          {t.agentSessionLastSeq} {formatNumber(boundSession.lastSeq, language)}{' '}
                                          {t.agentSessionLastCommandSeq}{' '}
                                          {boundSession.lastSeenCommandSeq !== undefined
                                            ? formatNumber(boundSession.lastSeenCommandSeq, language)
                                            : '-'}
                                        </p>
                                        <p>
                                          {t.agentSessionUpdatedAt} {formatDateTime(boundSession.updatedAt, language)}
                                        </p>
                                        {boundSession.lastHeartbeatAt ? (
                                          <p>
                                            {t.agentSessionHeartbeatAt} {formatDateTime(boundSession.lastHeartbeatAt, language)}
                                          </p>
                                        ) : null}
                                        {boundSession.version ? (
                                          <p>
                                            {t.agentSessionVersion} {boundSession.version}
                                          </p>
                                        ) : null}
                                        {boundSession.capabilities && boundSession.capabilities.length > 0 ? (
                                          <p className="break-all">
                                            {t.agentSessionCapabilities} {boundSession.capabilities.join(', ')}
                                          </p>
                                        ) : null}
                                      </div>
                                    ) : (
                                      <p>{t.agentSessionMissing}</p>
                                    )}
                                    {credential.replacedByCredentialId ? (
                                      <p className="break-all">
                                        {t.credentialReplacedBy} {credential.replacedByCredentialId}
                                      </p>
                                    ) : null}
                                  </div>
                                </td>
                                <td className="px-4 py-4 align-top text-xs text-[#35405A] dark:text-white/52">
                                  <p className="break-all">
                                    {t.credentialRequestId} {credential.requestId}
                                  </p>
                                </td>
                                <td className="px-4 py-4 align-top">
                                  <div className="flex flex-wrap gap-2">
                                    <GlowButton
                                      className="inline-flex items-center gap-2 px-3 py-2 text-[11px] font-bold disabled:cursor-not-allowed disabled:opacity-60"
                                      disabled={!canRotate || taskMutationBusy}
                                      onClick={() => runAgentCredentialOperation('rotate', credential.id)}
                                    >
                                      <RefreshCw className="h-3.5 w-3.5" />
                                      {t.rotateCredential}
                                    </GlowButton>
                                    <GlowButton
                                      className="inline-flex items-center gap-2 px-3 py-2 text-[11px] font-bold disabled:cursor-not-allowed disabled:opacity-60"
                                      disabled={!canRevoke || taskMutationBusy}
                                      onClick={() => runAgentCredentialOperation('revoke', credential.id)}
                                    >
                                      <Ban className="h-3.5 w-3.5" />
                                      {t.revokeCredential}
                                    </GlowButton>
                                  </div>
                                </td>
                              </tr>
                              {showOperationPreflight ? (
                                <tr>
                                  <td className="px-4 pb-4 pt-0" colSpan={6}>
                                    <AgentCredentialOperationPreflight
                                      credential={credential}
                                      language={language}
                                      session={boundSession}
                                      t={t}
                                    />
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </GlassCard>

              <GlassCard aria-label={t.sessions} className="account-safety-sessions-panel p-3" role="group">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <LogOut className="h-4 w-4 text-[#1E3AFF] dark:text-[#DDE3FF]" />
                      <h4 className="text-sm font-bold text-[#07111F] dark:text-white">{t.sessions}</h4>
                    </div>
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

function AgentCredentialOperationPreflight({
  credential,
  language,
  session,
  t
}: {
  credential: AgentCredentialSummary;
  language: AppLanguage;
  session: AgentSessionSummary | undefined;
  t: AdminAccountSettingsCopy;
}) {
  const summary = createAgentCredentialOperationImpactSummary(credential, session, t, language);
  const capabilityPreviewValues =
    summary.capabilityLabels.length > 0
      ? summary.capabilityLabels.slice(0, 5)
      : [t.credentialImpactNoCapabilities];

  return (
    <section
      aria-label={t.credentialOperationPreflight}
      className="border border-[#FF3D18] bg-[#FF3D18]/10 p-3 dark:border-[#FFB299]/20 dark:bg-[#FFB299]/10"
    >
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-[#B93C17] dark:text-[#FFB299]">
            {t.credentialOperationPreflight}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {capabilityPreviewValues.slice(0, 4).map((label) => (
              <span
                className="rounded-full border border-[#FF3D18] bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-bold text-[#07111F] dark:border-[#FFB299]/20 dark:bg-white/[0.04] dark:text-white/70"
                key={label}
              >
                {label}
              </span>
            ))}
            {summary.capabilityLabels.length > 4 ? (
              <span className="rounded-full border border-[#FF3D18] bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-bold text-[#35405A] dark:border-[#FFB299]/20 dark:bg-white/[0.04] dark:text-white/50">
                +{formatNumber(summary.capabilityLabels.length - 4, language)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <AgentCredentialOperationMetric label={t.credentialImpactAgent} value={credential.agentId} />
          <AgentCredentialOperationMetric label={t.credentialImpactSession} value={summary.sessionLabel} />
          <AgentCredentialOperationMetric
            label={t.credentialImpactCapabilities}
            value={formatNumber(summary.capabilityLabels.length, language)}
          />
          <AgentCredentialOperationMetric label={t.credentialImpactTokenPrefix} value={credential.tokenPrefix} />
          <AgentCredentialOperationMetric label={t.credentialImpactRequest} value={credential.requestId} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-3">
        <AgentCredentialOperationPreview title={t.credentialImpactCapabilityPreview} values={capabilityPreviewValues} />
        <AgentCredentialOperationPreview title={t.credentialImpactLifecyclePreview} values={summary.lifecycleLabels} />
        <AgentCredentialOperationPreview title={t.credentialImpactAuditPreview} values={summary.auditLabels} />
      </div>
    </section>
  );
}

function AgentCredentialOperationMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border border-[#FF3D18]/20 bg-[#FFFDF5]/80 px-3 py-2 dark:border-[#FFB299]/20 dark:bg-white/[0.035]">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/48">{label}</p>
      <p className="mt-1 break-all text-sm font-black text-[#07111F] dark:text-[#F4F8FF]">{value}</p>
      <span className="sr-only">
        {label} {value}
      </span>
    </div>
  );
}

function AgentCredentialOperationPreview({ title, values }: { title: string; values: string[] }) {
  return (
    <div className="min-w-0 border border-[#FF3D18]/20 bg-[#FFFDF5]/70 p-3 dark:border-[#FFB299]/20 dark:bg-white/[0.025]">
      <p className="text-[10px] font-black uppercase tracking-widest text-[#35405A] dark:text-white/48">{title}</p>
      <div className="mt-2 space-y-1 text-[#35405A] dark:text-white/62">
        {values.map((value) => (
          <p className="truncate text-xs font-bold" key={value} title={value}>
            {value}
          </p>
        ))}
      </div>
    </div>
  );
}

function createAgentCredentialOperationImpactSummary(
  credential: AgentCredentialSummary,
  session: AgentSessionSummary | undefined,
  labels: AdminAccountSettingsCopy,
  language: AppLanguage
): AgentCredentialOperationImpactSummary {
  const capabilityLabels =
    session?.capabilities && session.capabilities.length > 0
      ? session.capabilities
      : (credential.metadata.registrationCapabilities ?? credential.metadata.installProfile);
  const sessionLabel = credential.sessionId ?? labels.credentialNoSession;

  return {
    auditLabels: [
      `${labels.credentialRequestId} ${credential.requestId}`,
      `${labels.credentialIssuedBy} ${credential.issuedBy}`,
      `${labels.credentialSource} ${credential.sourceIp}`
    ],
    capabilityLabels: Array.from(new Set(capabilityLabels)).sort((left, right) => left.localeCompare(right)),
    lifecycleLabels: [
      `${labels.credentialIssuedAt} ${formatDateTime(credential.issuedAt, language)}`,
      `${labels.credentialExpiresAt} ${formatDateTime(credential.expiresAt, language)}`,
      `${labels.credentialLastUsedAt} ${
        credential.lastUsedAt ? formatDateTime(credential.lastUsedAt, language) : '-'
      }`
    ],
    sessionLabel
  };
}

function agentCredentialStatusClassName(status: AgentCredentialSummary['status']) {
  if (status === 'revoked') {
    return 'rounded-full bg-[#FFD8C6] px-3 py-1 text-[10px] font-bold uppercase text-[#B93C17] dark:bg-[#FF6B6B]/10 dark:text-[#FFB299]';
  }

  if (status === 'expired') {
    return 'rounded-full bg-[#D9FF00]/20 px-3 py-1 text-[10px] font-bold uppercase text-[#788800] dark:bg-[#E9FF6A]/10 dark:text-[#E9FF6A]';
  }

  return 'rounded-full bg-[#DCE1FF] px-3 py-1 text-[10px] font-bold uppercase text-[#1E3AFF] dark:bg-[#6B7CFF]/15 dark:text-[#6B7CFF]';
}

function agentSessionStatusClassName(status: AgentSessionSummary['status']) {
  if (status === 'offline') {
    return 'rounded-full bg-[#FFD8C6] px-3 py-1 text-[10px] font-bold uppercase text-[#B93C17] dark:bg-[#FF6B6B]/10 dark:text-[#FFB299]';
  }

  if (status === 'degraded') {
    return 'rounded-full bg-[#D9FF00]/20 px-3 py-1 text-[10px] font-bold uppercase text-[#788800] dark:bg-[#E9FF6A]/10 dark:text-[#E9FF6A]';
  }

  return 'rounded-full bg-[#EAF3D1] px-3 py-1 text-[10px] font-bold uppercase text-[#00A878] dark:bg-[#6B7CFF]/15 dark:text-[#35E68E]';
}

function createAgentSessionKey(agentId: string, sessionId: string) {
  return `${agentId}\u0000${sessionId}`;
}

function compareAgentCredentials(left: AgentCredentialSummary, right: AgentCredentialSummary) {
  const statusRank: Record<AgentCredentialSummary['status'], number> = {
    active: 0,
    expired: 1,
    revoked: 2
  };
  const purposeRank: Record<AgentCredentialSummary['purpose'], number> = {
    runtime: 0,
    install: 1
  };

  return (
    statusRank[left.status] - statusRank[right.status] ||
    purposeRank[left.purpose] - purposeRank[right.purpose] ||
    left.agentId.localeCompare(right.agentId) ||
    left.id.localeCompare(right.id)
  );
}
