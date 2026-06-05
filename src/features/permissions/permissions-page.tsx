import { useMemo, useState } from 'react';
import { KeyRound, LockKeyhole, RotateCcw, ShieldCheck, UsersRound } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { GlassCard } from '../../components/ui/glass-card';
import { GlassToggle } from '../../components/ui/glass-toggle';
import { GlowButton } from '../../components/ui/glow-button';
import type { OperatorSessionSummary, PermissionGrant, QuotaPolicy, ResourcePermission } from '../../domain';
import type { ForwardingRuleView } from '../forwarding/forwarding-page';
import { formatBytes, formatDateTime, formatNumber, formatPercent } from '../shared/format';
import { calculateQuotaPolicyUsageRatio } from '../../services/api/quota-policies';

type PermissionsPageProps = {
  currentOperatorSessionId?: string;
  grants: PermissionGrant[];
  language: AppLanguage;
  operatorSessions?: OperatorSessionSummary[];
  operatorSessionsError?: string;
  operatorSessionsLoading?: boolean;
  quotaPolicies: QuotaPolicy[];
  forwardingRules: ForwardingRuleView[];
  taskMutationBusy?: boolean;
  onRevokeOperatorSession?: (sessionId: string) => void;
  onRunTask: (id: string) => void;
  onResetQuota: (policy: QuotaPolicy) => void;
};

const permissionOrder: ResourcePermission[] = ['read', 'operate', 'configure', 'grant'];

const copy = {
  zh: {
    title: '分组授权',
    subtitle: '面向操作员、用户组、转发分组和端口转发资源的最小权限、配额约束与审计入口。',
    subjects: '授权主体',
    delegatedRoles: '授权角色',
    quotaPolicies: '配额策略',
    scopedForwarding: '受控转发',
    matrixTitle: '授权清单',
    leastPrivilege: '最小权限',
    rowHint: '操作员组变更会写入执行记录，再由后端持久化授权并记录审计证据。',
    submitChange: '提交权限变更',
    quotaTitle: '配额护栏',
    quotaUsage: '聚合配额使用',
    usage: '使用率',
    billingPolicy: '计费方向跟随端口转发账号策略。',
    quotaReadModelTitle: '真实配额读模型',
    quotaReadModelHint: '聚合受控主机、客户节点、端口转发账号和端口转发规则的真实配额状态，直接反映当前计费窗口内的使用量与停用原因。',
    quotaPoliciesEmpty: '当前没有可展示的真实配额读模型。',
    quotaFilterAll: '全部',
    quotaColumns: {
      object: '对象',
      scope: '范围',
      usage: '用量',
      billing: '计费',
      reset: '重置',
      state: '状态',
      reportedAt: '最近上报',
      action: '操作'
    },
    quotaScopeLabels: {
      user: '用户',
      'managed-host': '受控主机',
      'customer-node': '客户节点',
      'forwarding-account': '转发账号',
      'forward-rule': '端口转发规则'
    },
    quotaStateLabels: {
      active: '正常',
      exceeded: '超限',
      disabled_by_quota: '已停用',
      reset_pending: '待重置'
    },
    quotaResetLabels: {
      daily: '每日',
      weekly: '每周',
      monthly: '每月',
      manual: '手动'
    },
    quotaResetDay: (day?: number) => (day ? `每月 ${day} 日` : '未设置'),
    quotaSourceCount: (count?: number) => (count && count > 1 ? `${count} 条规则` : undefined),
    resetQuota: '重置配额',
    scopeTitle: '资源范围',
    sessionsTitle: '操作员会话',
    sessionsSubtitle: '服务端登记的控制面会话，可按会话撤销并保留审计证据。',
    sessionsLoading: '正在读取会话列表',
    sessionsEmpty: '当前没有可管理的操作员会话。',
    currentSession: '当前会话',
    revokeSession: '撤销会话',
    revokeCurrentSession: '撤销并退出',
    sessionStatus: {
      active: '活跃',
      revoked: '已撤销',
      expired: '已过期'
    },
    sessionIssuedAt: '签发',
    sessionExpiresAt: '到期',
    sessionRequestId: '请求',
    sessionUserAgent: '客户端',
    sessionSource: '来源',
    revokedMeta: (reason: string, actor: string) => `撤销原因：${reason} · 执行者：${actor}`,
    granted: '已授权',
    denied: '已拒绝',
    operator: 'operator',
    group: 'group'
  },
  en: {
    title: 'Group Authorization',
    subtitle:
      'Least-privilege access, quota guardrails, and audited permission changes for operators, groups, forwarding groups, and port-forwarding resources.',
    subjects: 'Subjects',
    delegatedRoles: 'Delegated Roles',
    quotaPolicies: 'Quota Policies',
    scopedForwarding: 'Scoped Forwarding',
    matrixTitle: 'Access Grants',
    leastPrivilege: 'Least Privilege',
    rowHint:
      'Operator group changes are written to the execution log before the backend persists grants and records audit evidence.',
    submitChange: 'Submit Permission Change',
    quotaTitle: 'Quota Guard',
    quotaUsage: 'Aggregated quota usage',
    usage: 'Usage',
    billingPolicy: 'Billing direction follows port-forwarding account policy.',
    quotaReadModelTitle: 'Live Quota Read Model',
    quotaReadModelHint:
      'Aggregate the real quota state for managed hosts, customer nodes, forwarding accounts, and forwarding rules so operators can inspect usage, billing windows, and disable reasons directly.',
    quotaPoliciesEmpty: 'No live quota read model is available yet.',
    quotaFilterAll: 'All',
    quotaColumns: {
      object: 'Object',
      scope: 'Scope',
      usage: 'Usage',
      billing: 'Billing',
      reset: 'Reset',
      state: 'State',
      reportedAt: 'Reported',
      action: 'Action'
    },
    quotaScopeLabels: {
      user: 'User',
      'managed-host': 'Managed Host',
      'customer-node': 'Customer Node',
      'forwarding-account': 'Forwarding Account',
      'forward-rule': 'Port Forwarding Rule'
    },
    quotaStateLabels: {
      active: 'Active',
      exceeded: 'Exceeded',
      disabled_by_quota: 'Disabled',
      reset_pending: 'Reset Pending'
    },
    quotaResetLabels: {
      daily: 'Daily',
      weekly: 'Weekly',
      monthly: 'Monthly',
      manual: 'Manual'
    },
    quotaResetDay: (day?: number) => (day ? `Day ${day}` : 'Unset'),
    quotaSourceCount: (count?: number) => (count && count > 1 ? `${count} rules` : undefined),
    resetQuota: 'Reset Quota',
    scopeTitle: 'Resource Scope',
    sessionsTitle: 'Operator Sessions',
    sessionsSubtitle: 'Server-recorded control-plane sessions can be revoked per session with audit evidence.',
    sessionsLoading: 'Loading operator sessions',
    sessionsEmpty: 'No operator sessions are available.',
    currentSession: 'Current Session',
    revokeSession: 'Revoke Session',
    revokeCurrentSession: 'Revoke and Sign Out',
    sessionStatus: {
      active: 'Active',
      revoked: 'Revoked',
      expired: 'Expired'
    },
    sessionIssuedAt: 'Issued',
    sessionExpiresAt: 'Expires',
    sessionRequestId: 'Request',
    sessionUserAgent: 'Client',
    sessionSource: 'Source',
    revokedMeta: (reason: string, actor: string) => `Revocation reason: ${reason} · Actor: ${actor}`,
    granted: 'granted',
    denied: 'denied',
    operator: 'operator',
    group: 'group'
  }
} as const;

export function PermissionsPage({
  currentOperatorSessionId,
  grants,
  language,
  operatorSessions = [],
  operatorSessionsError,
  operatorSessionsLoading = false,
  quotaPolicies,
  forwardingRules,
  taskMutationBusy = false,
  onRevokeOperatorSession,
  onRunTask,
  onResetQuota
}: PermissionsPageProps) {
  const t = copy[language];
  const [quotaScopeFilter, setQuotaScopeFilter] = useState<QuotaPolicy['scope'] | 'all'>('all');
  const activeQuotaPolicies = quotaPolicies.filter((policy) => policy.enforcementState === 'active').length;
  const privilegedGrants = grants.filter((grant) => grant.permissions.includes('grant')).length;
  const totalQuota = quotaPolicies.reduce((sum, policy) => sum + policy.limitBytes, 0);
  const usedQuota = quotaPolicies.reduce((sum, policy) => sum + policy.usedBytes, 0);
  const quotaUsage = totalQuota > 0 ? Math.min((usedQuota / totalQuota) * 100, 100) : 0;
  const activeOperatorSessions = operatorSessions.filter((session) => session.status === 'active').length;
  const quotaScopeOptions = useMemo(
    () => ['all', ...new Set(quotaPolicies.map((policy) => policy.scope))] as Array<QuotaPolicy['scope'] | 'all'>,
    [quotaPolicies]
  );
  const visibleQuotaPolicies = useMemo(
    () =>
      quotaPolicies.filter((policy) => {
        if (quotaScopeFilter === 'all') {
          return true;
        }

        return policy.scope === quotaScopeFilter;
      }),
    [quotaPolicies, quotaScopeFilter]
  );

  return (
    <div className="space-y-6">
      <section className="stagger-1">
        <h3 className="text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-white/50">
          {t.subtitle}
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <SummaryCard icon={UsersRound} label={t.subjects} value={formatNumber(grants.length)} />
        <SummaryCard icon={ShieldCheck} label={t.delegatedRoles} value={formatNumber(privilegedGrants)} />
        <SummaryCard icon={LockKeyhole} label={t.quotaPolicies} value={`${activeQuotaPolicies}/${quotaPolicies.length}`} />
        <SummaryCard icon={KeyRound} label={t.scopedForwarding} value={formatNumber(forwardingRules.length)} />
      </section>

      <section className="stagger-2 grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <GlassCard className="tilt-card p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-500 dark:text-primary" />
              <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.matrixTitle}</h4>
            </div>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-bold text-blue-600 dark:bg-primary/15 dark:text-primary">
              {t.leastPrivilege}
            </span>
          </div>

          <div className="space-y-3">
            {grants.map((grant) => (
              <div key={grant.id} className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-all text-sm font-bold text-slate-900 dark:text-white">
                        <span>{formatSubject(grant, t)}</span>
                        <span> → {grant.resourceId}</span>
                      </p>
                      <p className="mt-1 break-all font-mono text-[11px] text-slate-500 dark:text-white/45">
                      {formatResourceType(grant.resourceType, language)} · grant-id {grant.id}
                      </p>
                    </div>
                  <GlassToggle aria-label={`${grant.id} enabled`} checked readOnly />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                  {permissionOrder.map((permission) => (
                    <PermissionCell
                      key={permission}
                      enabled={grant.permissions.includes(permission)}
                      label={permission}
                      statusLabels={{ denied: t.denied, granted: t.granted }}
                    />
                  ))}
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                  <p className="min-w-0 text-xs text-slate-500 dark:text-white/50">
                    {t.rowHint}
                  </p>
                  <GlowButton
                    className="px-4 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={taskMutationBusy}
                    onClick={() => onRunTask(grant.id)}
                  >
                    {t.submitChange}
                  </GlowButton>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>

        <div className="space-y-5">
          <GlassCard className="tilt-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <LockKeyhole className="h-4 w-4 text-blue-500 dark:text-primary" />
              <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.quotaTitle}</h4>
            </div>
            <div className="mb-2 flex justify-between text-xs text-slate-500 dark:text-white/50">
              <span>{t.quotaUsage}</span>
              <span>
                {formatBytes(usedQuota)} / {formatBytes(totalQuota)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
              <div className="h-full rounded-full bg-blue-500 dark:bg-primary" style={{ width: `${quotaUsage}%` }} />
            </div>
            <p className="mt-3 text-[11px] text-slate-500 dark:text-white/45">
              {t.usage} {formatPercent(quotaUsage)} · {t.billingPolicy}
            </p>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-blue-500 dark:text-primary" />
              <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.scopeTitle}</h4>
            </div>
            <div className="space-y-3">
              {forwardingRules.slice(0, 4).map((rule) => (
                <div key={rule.id} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-800 dark:text-white/80">{rule.name}</p>
                      <p className="mt-1 break-all font-mono text-[10px] text-slate-500 dark:text-white/45">
                        {rule.sourceAddress}:{rule.listenPort} → {rule.targetAddress}:{rule.targetPort}
                      </p>
                    </div>
                    <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-white/50">
                      {rule.billingDirection}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard className="tilt-card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-blue-500 dark:text-primary" />
                  <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.sessionsTitle}</h4>
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-white/45">{t.sessionsSubtitle}</p>
              </div>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-bold text-blue-600 dark:bg-primary/15 dark:text-primary">
                {activeOperatorSessions}/{operatorSessions.length}
              </span>
            </div>

            {operatorSessionsLoading ? (
              <p className="text-xs text-slate-500 dark:text-white/45">{t.sessionsLoading}</p>
            ) : operatorSessionsError ? (
              <p className="text-xs text-red-600 dark:text-red-300">{operatorSessionsError}</p>
            ) : operatorSessions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-xs text-slate-500 dark:border-white/10 dark:text-white/45">
                {t.sessionsEmpty}
              </div>
            ) : (
              <div className="space-y-3">
                {operatorSessions.map((session) => {
                  const isCurrentSession = session.id === currentOperatorSessionId;
                  const disabled = session.status !== 'active' || taskMutationBusy || !onRevokeOperatorSession;

                  return (
                    <div key={session.id} className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-all text-sm font-bold text-slate-900 dark:text-white">
                            {session.username}
                            <span className="text-slate-500 dark:text-white/45"> · {session.actor}</span>
                          </p>
                          <p className="mt-1 break-all font-mono text-[11px] text-slate-500 dark:text-white/45">
                            {session.id}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {isCurrentSession ? (
                            <span className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-bold text-blue-600 dark:bg-primary/15 dark:text-primary">
                              {t.currentSession}
                            </span>
                          ) : null}
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-white/10 dark:text-white/70">
                            {t.sessionStatus[session.status]}
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-2 text-[11px] text-slate-500 dark:text-white/45">
                        <p className="break-all">
                          {t.sessionSource} {session.sourceIp}
                        </p>
                        <p className="break-all">
                          {t.sessionIssuedAt} {formatDateTime(session.issuedAt, language)} · {t.sessionExpiresAt}{' '}
                          {formatDateTime(session.expiresAt, language)}
                        </p>
                        <p className="break-all">
                          {t.sessionRequestId} {session.requestId}
                        </p>
                        {session.userAgent ? (
                          <p className="break-all">
                            {t.sessionUserAgent} {session.userAgent}
                          </p>
                        ) : null}
                        {session.revokedAt ? (
                          <p className="break-all">
                            {formatDateTime(session.revokedAt, language)} ·{' '}
                            {t.revokedMeta(session.revokedReason ?? '-', session.revokedBy ?? '-')}
                          </p>
                        ) : null}
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
      </section>

      <GlassCard className="stagger-3 p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.quotaReadModelTitle}</h4>
            <p className="mt-1 max-w-4xl text-xs text-slate-500 dark:text-white/50">{t.quotaReadModelHint}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {quotaScopeOptions.map((scope) => (
              <ScopeFilterButton
                key={scope}
                active={quotaScopeFilter === scope}
                label={
                  scope === 'all'
                    ? `${t.quotaFilterAll} · ${formatNumber(quotaPolicies.length)}`
                    : `${t.quotaScopeLabels[scope]} · ${formatNumber(
                        quotaPolicies.filter((policy) => policy.scope === scope).length
                      )}`
                }
                onClick={() => setQuotaScopeFilter(scope)}
              />
            ))}
          </div>
        </div>

        {visibleQuotaPolicies.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-4 text-xs text-slate-500 dark:border-white/10 dark:text-white/45">
            {t.quotaPoliciesEmpty}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left">
              <thead className="text-[11px] uppercase tracking-[0.24em] text-slate-500 dark:text-white/35">
                <tr>
                  <th className="px-4 py-3">{t.quotaColumns.object}</th>
                  <th className="px-4 py-3">{t.quotaColumns.scope}</th>
                  <th className="px-4 py-3">{t.quotaColumns.usage}</th>
                  <th className="px-4 py-3">{t.quotaColumns.billing}</th>
                  <th className="px-4 py-3">{t.quotaColumns.reset}</th>
                  <th className="px-4 py-3">{t.quotaColumns.state}</th>
                  <th className="px-4 py-3">{t.quotaColumns.reportedAt}</th>
                  <th className="px-4 py-3">{t.quotaColumns.action}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm text-slate-700 dark:divide-white/10 dark:text-white/75">
                {visibleQuotaPolicies.map((policy) => {
                  const usageRatio = calculateQuotaPolicyUsageRatio(policy);

                  return (
                    <tr key={policy.id}>
                      <td className="px-4 py-4 align-top">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900 dark:text-white">{policy.name}</p>
                          {policy.detail ? (
                            <p className="mt-1 truncate text-xs text-slate-500 dark:text-white/45">{policy.detail}</p>
                          ) : null}
                          <p className="mt-1 truncate font-mono text-[11px] text-slate-400 dark:text-white/30">{policy.id}</p>
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top text-xs text-slate-500 dark:text-white/45">
                        <div>
                          <p>{t.quotaScopeLabels[policy.scope]}</p>
                          {t.quotaSourceCount(policy.sourceCount) ? <p className="mt-1">{t.quotaSourceCount(policy.sourceCount)}</p> : null}
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <div className="min-w-[240px]">
                          <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                            <span className="font-semibold text-slate-900 dark:text-white">{formatBytes(policy.usedBytes)}</span>
                            <span className="text-slate-500 dark:text-white/45">
                              {policy.limitBytes > 0 ? formatBytes(policy.limitBytes) : '∞'}
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                            <div
                              className={
                                policy.enforcementState === 'disabled_by_quota'
                                  ? 'h-full rounded-full bg-red-500'
                                  : policy.enforcementState === 'exceeded'
                                    ? 'h-full rounded-full bg-amber-500'
                                    : 'h-full rounded-full bg-blue-500 dark:bg-primary'
                              }
                              style={{ width: `${Math.max(usageRatio * 100, policy.usedBytes > 0 ? 4 : 0)}%` }}
                            />
                          </div>
                          <p className="mt-2 text-[11px] text-slate-500 dark:text-white/45">{formatPercent(usageRatio * 100)}</p>
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top text-xs">{formatBillingDirection(policy.billingDirection, language)}</td>
                      <td className="px-4 py-4 align-top text-xs text-slate-500 dark:text-white/45">
                        <div>
                          <p>{t.quotaResetLabels[policy.resetWindow]}</p>
                          {policy.resetWindow === 'monthly' ? <p className="mt-1">{t.quotaResetDay(policy.resetDay)}</p> : null}
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top text-xs">
                        <span className={quotaStateClassName(policy.enforcementState)}>
                          {t.quotaStateLabels[policy.enforcementState]}
                        </span>
                        {policy.guardrailReason ? (
                          <p className="mt-2 break-all text-[11px] text-slate-500 dark:text-white/45">{policy.guardrailReason}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-4 align-top text-xs text-slate-500 dark:text-white/45">
                        {policy.reportedAt ? formatDateTime(policy.reportedAt, language) : '—'}
                      </td>
                      <td className="px-4 py-4 align-top">
                        <GlowButton
                          className="inline-flex items-center gap-2 px-3 py-2 text-[11px] font-bold disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={taskMutationBusy}
                          onClick={() => onResetQuota(policy)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {t.resetQuota}
                        </GlowButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof UsersRound }) {
  return (
    <GlassCard className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
          <p className="mt-3 text-xl font-black text-slate-900 dark:text-white">{value}</p>
        </div>
        <Icon className="h-5 w-5 text-blue-500 dark:text-primary" />
      </div>
    </GlassCard>
  );
}

function PermissionCell({
  enabled,
  label,
  statusLabels
}: {
  enabled: boolean;
  label: ResourcePermission;
  statusLabels: { denied: string; granted: string };
}) {
  return (
    <div
      className={
        enabled
          ? 'rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-primary/20 dark:bg-primary/15'
          : 'rounded-xl border border-slate-200 p-3 opacity-50 dark:border-white/10'
      }
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <p className="mt-1 text-xs font-black text-slate-900 dark:text-white">
        {enabled ? statusLabels.granted : statusLabels.denied}
      </p>
    </div>
  );
}

function ScopeFilterButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={
        active
          ? 'rounded-xl bg-blue-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-blue-500/20 dark:bg-primary dark:text-slate-950'
          : 'rounded-xl border border-slate-200 bg-white/60 px-4 py-2 text-xs font-bold text-slate-500 transition hover:text-blue-600 dark:border-white/10 dark:bg-white/5 dark:text-white/50 dark:hover:text-primary'
      }
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function quotaStateClassName(state: QuotaPolicy['enforcementState']) {
  if (state === 'disabled_by_quota') {
    return 'rounded-full bg-red-50 px-3 py-1 text-[10px] font-bold uppercase text-red-600 dark:bg-red-500/10 dark:text-red-300';
  }

  if (state === 'exceeded') {
    return 'rounded-full bg-amber-50 px-3 py-1 text-[10px] font-bold uppercase text-amber-600 dark:bg-amber-500/10 dark:text-amber-300';
  }

  if (state === 'reset_pending') {
    return 'rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-white/10 dark:text-white/70';
  }

  return 'rounded-full bg-blue-50 px-3 py-1 text-[10px] font-bold uppercase text-blue-600 dark:bg-primary/15 dark:text-primary';
}

function formatSubject(grant: PermissionGrant, labels: { group: string; operator: string }) {
  return `${grant.subjectType === 'user' ? labels.operator : labels.group}:${grant.subjectId}`;
}

function formatBillingDirection(direction: QuotaPolicy['billingDirection'], language: AppLanguage) {
  const zhLabels: Record<QuotaPolicy['billingDirection'], string> = {
    both: '双向',
    single: '单向',
    ingress: '仅入站',
    egress: '仅出站'
  };
  const enLabels: Record<QuotaPolicy['billingDirection'], string> = {
    both: 'Both',
    single: 'One-way',
    ingress: 'Ingress',
    egress: 'Egress'
  };

  return language === 'zh' ? zhLabels[direction] : enLabels[direction];
}

function formatResourceType(resourceType: PermissionGrant['resourceType'], language: AppLanguage) {
  const zhLabels: Record<PermissionGrant['resourceType'], string> = {
    agent: '主机代理',
    node: '节点',
    tunnel: '端口转发',
    'tunnel-group': '转发分组',
    subscription: '订阅',
    'forward-rule': '转发规则'
  };

  const enLabels: Record<PermissionGrant['resourceType'], string> = {
    agent: 'Agent',
    node: 'Node',
    tunnel: 'Port Forwarding',
    'tunnel-group': 'Forwarding Group',
    subscription: 'Subscription',
    'forward-rule': 'Forward Rule'
  };

  return language === 'zh' ? zhLabels[resourceType] : enLabels[resourceType];
}
