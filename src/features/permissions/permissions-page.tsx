import { KeyRound, LockKeyhole, ShieldCheck, UsersRound } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { GlassCard } from '../../components/ui/glass-card';
import { GlassToggle } from '../../components/ui/glass-toggle';
import { GlowButton } from '../../components/ui/glow-button';
import type { PermissionGrant, QuotaPolicy, ResourcePermission } from '../../domain';
import type { ForwardingRuleView } from '../forwarding/forwarding-page';
import { formatBytes, formatNumber, formatPercent } from '../shared/format';

type PermissionsPageProps = {
  grants: PermissionGrant[];
  language: AppLanguage;
  quotaPolicies: QuotaPolicy[];
  forwardingRules: ForwardingRuleView[];
  taskMutationBusy?: boolean;
  onRunTask: (id: string) => void;
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
    scopeTitle: '资源范围',
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
    scopeTitle: 'Resource Scope',
    granted: 'granted',
    denied: 'denied',
    operator: 'operator',
    group: 'group'
  }
} as const;

export function PermissionsPage({
  grants,
  language,
  quotaPolicies,
  forwardingRules,
  taskMutationBusy = false,
  onRunTask
}: PermissionsPageProps) {
  const t = copy[language];
  const activeQuotaPolicies = quotaPolicies.filter((policy) => policy.enforcementState === 'active').length;
  const privilegedGrants = grants.filter((grant) => grant.permissions.includes('grant')).length;
  const totalQuota = quotaPolicies.reduce((sum, policy) => sum + policy.limitBytes, 0);
  const usedQuota = quotaPolicies.reduce((sum, policy) => sum + policy.usedBytes, 0);
  const quotaUsage = totalQuota > 0 ? Math.min((usedQuota / totalQuota) * 100, 100) : 0;

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
        </div>
      </section>
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

function formatSubject(grant: PermissionGrant, labels: { group: string; operator: string }) {
  return `${grant.subjectType === 'user' ? labels.operator : labels.group}:${grant.subjectId}`;
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
