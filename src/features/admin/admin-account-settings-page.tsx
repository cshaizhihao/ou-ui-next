import { useMemo, useState } from 'react';
import { KeyRound, LogOut, RefreshCw, ShieldCheck, TerminalSquare, UserRound } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { GlassCard } from '../../components/ui/glass-card';
import { GlowButton } from '../../components/ui/glow-button';
import type { OperatorSessionSummary } from '../../domain';
import { formatDateTime } from '../shared/format';

type AdminAccountSettingsPageProps = {
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
    sessions: '操作员会话',
    sessionsHint: '撤销活跃会话会写入审计证据；撤销当前会话后需要重新登录。',
    sessionsLoading: '正在读取会话列表',
    sessionsEmpty: '当前没有可管理的操作员会话。',
    currentSession: '当前会话',
    revokeSession: '撤销会话',
    revokeCurrentSession: '撤销并退出',
    status: {
      active: '活跃',
      revoked: '已撤销',
      expired: '已过期'
    },
    issuedAt: '签发',
    expiresAt: '到期',
    sourceIp: '来源',
    requestId: '请求',
    userAgent: '客户端'
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
    sessions: 'Operator Sessions',
    sessionsHint: 'Revoking active sessions writes audit evidence. Revoking the current session requires signing in again.',
    sessionsLoading: 'Loading operator sessions',
    sessionsEmpty: 'No operator sessions are available.',
    currentSession: 'Current Session',
    revokeSession: 'Revoke Session',
    revokeCurrentSession: 'Revoke and Sign Out',
    status: {
      active: 'Active',
      revoked: 'Revoked',
      expired: 'Expired'
    },
    issuedAt: 'Issued',
    expiresAt: 'Expires',
    sourceIp: 'Source',
    requestId: 'Request',
    userAgent: 'Client'
  }
} as const;

const commandOptions = {
  rotate: 'sudo ou-ui rotate-credentials',
  credentials: 'sudo ou-ui credentials'
} as const;

export function AdminAccountSettingsPage({
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
  onRevokeOperatorSession
}: AdminAccountSettingsPageProps) {
  const t = copy[language];
  const [selectedCommand, setSelectedCommand] = useState<keyof typeof commandOptions>('rotate');
  const activeSessions = useMemo(
    () => operatorSessions.filter((session) => session.status === 'active').length,
    [operatorSessions]
  );

  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-white/50">{t.subtitle}</p>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <GlassCard className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <UserRound className="h-4 w-4 text-blue-500 dark:text-primary" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.identity}</h4>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <IdentityMetric icon={KeyRound} label={t.username} value={loginUsername} />
            <IdentityMetric icon={ShieldCheck} label={t.operatorGroup} value={operatorGroupId} />
            <IdentityMetric icon={ShieldCheck} label={t.resourceGroup} value={resourceGroupId} />
            <IdentityMetric icon={RefreshCw} label={t.mode} value={controlPlaneMode} />
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <TerminalSquare className="h-4 w-4 text-blue-500 dark:text-primary" />
                <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.resetTitle}</h4>
              </div>
              <p className="mt-2 max-w-3xl text-xs text-slate-500 dark:text-white/45">{t.resetHint}</p>
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
        </GlassCard>
      </section>

      <GlassCard className="p-5">
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
                <div key={session.id} className="rounded-lg border border-slate-200 p-4 dark:border-white/10">
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
                        onClick={() => onRevokeOperatorSession(session.id)}
                      >
                        {isCurrentSession ? t.revokeCurrentSession : t.revokeSession}
                      </GlowButton>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>
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

function SessionPill({ label, tone }: { label: string; tone: 'blue' | 'green' | 'slate' }) {
  const className =
    tone === 'blue'
      ? 'bg-blue-50 text-blue-600 dark:bg-primary/15 dark:text-primary'
      : tone === 'green'
        ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300'
        : 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/70';

  return <span className={`${className} rounded-full px-3 py-1 text-[10px] font-bold uppercase`}>{label}</span>;
}
