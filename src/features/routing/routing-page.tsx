import { useMemo, useState } from 'react';
import { Copy, GitBranch, Network, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { GlassCard } from '../../components/ui/glass-card';
import { GlassToggle } from '../../components/ui/glass-toggle';
import { GlowButton } from '../../components/ui/glow-button';
import type { RoutingPolicy } from '../../domain';
import { formatNumber } from '../shared/format';

export type { RoutingPolicy };

type RoutingPageProps = {
  policies: RoutingPolicy[];
  language: AppLanguage;
  taskMutationBusy?: boolean;
  onRunTask: (id: string, policyIds?: string[]) => void;
};

type RoutingActionFilter = RoutingPolicy['action'] | 'all';
type RoutingRiskFilter = RoutingPolicy['riskLevel'] | 'all';

const copy = {
  zh: {
    title: '分流策略',
    subtitle: '将域名、CIDR、GeoIP 与应用标签映射到直连、代理或拒绝策略。',
    matrixTitle: '策略清单',
    priority: '优先级',
    targetGroup: '目标组',
    hits: '命中',
    submitTitle: '策略提交',
    submitDescription:
      'V1.0 会先记录策略变更并等待 Agent 回执。真实内核路由、Xray route 编译和热重载必须由后端 Agent 回报结果后才能标记成功。',
    policyCount: '策略数量',
    highRiskRules: '高风险规则',
    highRiskFilter: '高风险',
    visibleHits: '当前命中',
    searchPolicies: '搜索策略',
    searchPoliciesPlaceholder: '策略名称、规则、目标组或策略 ID',
    action: '动作',
    risk: '风险',
    allActions: '全部动作',
    allRisks: '全部风险',
    matchingPolicies: '匹配',
    noMatchingPolicies: '没有匹配的分流策略',
    selectPolicy: '选择',
    selectVisiblePolicies: '选择当前策略',
    selectedPolicies: '已选策略',
    compile: '编译当前策略',
    compileSelectedPolicies: '编译已选策略',
    copySelectedCompilePlan: '复制已选编译计划',
    confirmRiskyCompile: (count: string) => `确认编译 ${count} 条高风险或拒绝策略？`,
    compileImpactPreflight: '路由编译影响预检',
    compileImpactHint: '基于已选分流策略的目标组、动作分布、命中量和高风险拒绝规则预估编译影响。',
    compileImpactTargets: '目标组',
    compileImpactDirect: '直连策略',
    compileImpactProxy: '代理策略',
    compileImpactReject: '拒绝策略',
    compileImpactRisky: '风险策略',
    compileImpactSelectedHits: '已选命中',
    compileImpactTargetPreview: '目标预览',
    compileImpactMatchPreview: '匹配预览',
    compileImpactRiskPreview: '风险预览',
    compileImpactNoRisk: '暂无高风险或拒绝策略',
    actionLabels: {
      direct: '直连',
      proxy: '代理',
      reject: '拒绝'
    },
    riskLabels: {
      low: '低',
      medium: '中',
      high: '高'
    }
  },
  en: {
    title: 'Routing Policy',
    subtitle: 'Map domains, CIDR ranges, GeoIP rules, and application tags to Direct, Proxy, or Reject policies.',
    matrixTitle: 'Policy List',
    priority: 'Priority',
    targetGroup: 'Target Group',
    hits: 'Hits',
    submitTitle: 'Policy Submission',
    submitDescription:
      'V1.0 records policy changes and waits for Agent acknowledgement. Kernel routes, Xray route compilation, and hot reloads are marked successful only after the backend receives an Agent result.',
    policyCount: 'Policy Count',
    highRiskRules: 'High-Risk Rules',
    highRiskFilter: 'High Risk',
    visibleHits: 'Visible Hits',
    searchPolicies: 'Search Policies',
    searchPoliciesPlaceholder: 'Policy name, rule, target group, or policy ID',
    action: 'Action',
    risk: 'Risk',
    allActions: 'All Actions',
    allRisks: 'All Risks',
    matchingPolicies: 'Matching',
    noMatchingPolicies: 'No matching routing policies',
    selectPolicy: 'Select',
    selectVisiblePolicies: 'Select Visible Policies',
    selectedPolicies: 'Selected Policies',
    compile: 'Compile Visible Policies',
    compileSelectedPolicies: 'Compile Selected Policies',
    copySelectedCompilePlan: 'Copy Selected Compile Plan',
    confirmRiskyCompile: (count: string) =>
      `Compile ${count} high-risk or reject polic${count === '1' ? 'y' : 'ies'}?`,
    compileImpactPreflight: 'Routing Compile Impact Preflight',
    compileImpactHint:
      'Estimate compile impact from selected routing policies, target groups, action distribution, hits, and risky reject rules.',
    compileImpactTargets: 'Target Groups',
    compileImpactDirect: 'Direct Policies',
    compileImpactProxy: 'Proxy Policies',
    compileImpactReject: 'Reject Policies',
    compileImpactRisky: 'Risky Policies',
    compileImpactSelectedHits: 'Selected Hits',
    compileImpactTargetPreview: 'Target Preview',
    compileImpactMatchPreview: 'Match Preview',
    compileImpactRiskPreview: 'Risk Preview',
    compileImpactNoRisk: 'No high-risk or reject policies',
    actionLabels: {
      direct: 'Direct',
      proxy: 'Proxy',
      reject: 'Reject'
    },
    riskLabels: {
      low: 'Low',
      medium: 'Medium',
      high: 'High'
    }
  }
} as const;

type RoutingCopy = (typeof copy)[AppLanguage];
type RoutingCompileImpactSummary = {
  directPolicyCount: number;
  matchLabels: string[];
  proxyPolicyCount: number;
  rejectPolicyCount: number;
  riskyPolicyLabels: string[];
  riskyPolicyCount: number;
  targetGroupLabels: string[];
  totalHits: number;
};

function createPolicySearchText(policy: RoutingPolicy) {
  return [policy.id, policy.name, policy.match, policy.action, policy.targetGroup, policy.riskLevel, String(policy.priority)]
    .join(' ')
    .toLowerCase();
}

function filterRoutingPolicies(
  policies: RoutingPolicy[],
  query: string,
  actionFilter: RoutingActionFilter,
  riskFilter: RoutingRiskFilter
) {
  const normalizedQuery = query.trim().toLowerCase();

  return policies.filter((policy) => {
    const matchesQuery = normalizedQuery === '' || createPolicySearchText(policy).includes(normalizedQuery);
    const matchesAction = actionFilter === 'all' || policy.action === actionFilter;
    const matchesRisk = riskFilter === 'all' || policy.riskLevel === riskFilter;

    return matchesQuery && matchesAction && matchesRisk;
  });
}

function isRiskyPolicy(policy: RoutingPolicy) {
  return policy.riskLevel === 'high' || policy.action === 'reject';
}

function createRoutingCompilePlanText(policies: RoutingPolicy[]) {
  const riskyPolicies = policies.filter(isRiskyPolicy);
  const visibleHits = policies.reduce((total, policy) => total + policy.hitCount, 0);

  return [
    'Routing Compile Plan',
    `Policy Count: ${policies.length}`,
    `Risky Policies: ${riskyPolicies.length}`,
    `Visible Hits: ${visibleHits}`,
    '',
    ...policies.map((policy) =>
      [
        `- ${policy.name}`,
        `  ID: ${policy.id}`,
        `  Action: ${policy.action}`,
        `  Risk: ${policy.riskLevel}`,
        `  Priority: ${policy.priority}`,
        `  Target Group: ${policy.targetGroup}`,
        `  Hits: ${policy.hitCount}`,
        `  Match: ${policy.match}`
      ].join('\n')
    )
  ].join('\n');
}

function createRoutingCompileImpactSummary(policies: RoutingPolicy[]): RoutingCompileImpactSummary {
  const targetGroupLabels = new Set<string>();
  let directPolicyCount = 0;
  let proxyPolicyCount = 0;
  let rejectPolicyCount = 0;
  let totalHits = 0;
  const riskyPolicyLabels: string[] = [];

  policies.forEach((policy) => {
    targetGroupLabels.add(policy.targetGroup);
    totalHits += policy.hitCount;

    if (policy.action === 'direct') {
      directPolicyCount += 1;
    }

    if (policy.action === 'proxy') {
      proxyPolicyCount += 1;
    }

    if (policy.action === 'reject') {
      rejectPolicyCount += 1;
    }

    if (isRiskyPolicy(policy)) {
      riskyPolicyLabels.push(`${policy.name} · ${policy.action} · ${policy.riskLevel}`);
    }
  });

  return {
    directPolicyCount,
    matchLabels: policies.map((policy) => policy.match),
    proxyPolicyCount,
    rejectPolicyCount,
    riskyPolicyCount: riskyPolicyLabels.length,
    riskyPolicyLabels,
    targetGroupLabels: Array.from(targetGroupLabels).sort((left, right) => left.localeCompare(right)),
    totalHits
  };
}

export function RoutingPage({ policies, language, taskMutationBusy = false, onRunTask }: RoutingPageProps) {
  const t = copy[language];
  const [policySearch, setPolicySearch] = useState('');
  const [actionFilter, setActionFilter] = useState<RoutingActionFilter>('all');
  const [riskFilter, setRiskFilter] = useState<RoutingRiskFilter>('all');
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<string[]>([]);
  const filteredPolicies = useMemo(
    () => filterRoutingPolicies(policies, policySearch, actionFilter, riskFilter),
    [actionFilter, policies, policySearch, riskFilter]
  );
  const selectedPolicies = filteredPolicies.filter((policy) => selectedPolicyIds.includes(policy.id));
  const selectedVisiblePolicyCount = filteredPolicies.filter((policy) => selectedPolicyIds.includes(policy.id)).length;
  const visibleHits = filteredPolicies.reduce((total, policy) => total + policy.hitCount, 0);
  const highRiskCount = policies.filter((policy) => policy.riskLevel === 'high').length;
  const riskyVisiblePolicyCount = filteredPolicies.filter(isRiskyPolicy).length;
  const riskySelectedPolicyCount = selectedPolicies.filter(isRiskyPolicy).length;
  const selectedCompileImpactSummary = useMemo(
    () => createRoutingCompileImpactSummary(selectedPolicies),
    [selectedPolicies]
  );

  function confirmCompileRisk(riskyPolicyCount: number) {
    return (
      riskyPolicyCount === 0 ||
      typeof window === 'undefined' ||
      window.confirm(t.confirmRiskyCompile(String(riskyPolicyCount)))
    );
  }

  function togglePolicySelection(policyId: string) {
    setSelectedPolicyIds((current) =>
      current.includes(policyId) ? current.filter((id) => id !== policyId) : [...current, policyId]
    );
  }

  function toggleVisiblePolicySelection() {
    const visibleIds = filteredPolicies.map((policy) => policy.id);

    setSelectedPolicyIds((current) => {
      const visibleIdSet = new Set(visibleIds);
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => current.includes(id));

      return allVisibleSelected
        ? current.filter((id) => !visibleIdSet.has(id))
        : Array.from(new Set([...current, ...visibleIds]));
    });
  }

  function compileVisiblePolicies() {
    if (filteredPolicies.length === 0) {
      return;
    }

    if (confirmCompileRisk(riskyVisiblePolicyCount)) {
      onRunTask('routing-policy-matrix', filteredPolicies.map((policy) => policy.id));
    }
  }

  function compileSelectedPolicies() {
    if (selectedPolicies.length === 0) {
      return;
    }

    if (confirmCompileRisk(riskySelectedPolicyCount)) {
      onRunTask('routing-policy-matrix', selectedPolicies.map((policy) => policy.id));
    }
  }

  function copySelectedCompilePlan() {
    if (selectedPolicies.length === 0 || typeof navigator === 'undefined') {
      return;
    }

    void navigator.clipboard?.writeText(createRoutingCompilePlanText(selectedPolicies));
  }

  return (
    <div className="space-y-6">
      <section className="stagger-1">
        <h3 className="text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-white/50">{t.subtitle}</p>
      </section>

      <section className="stagger-2 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <GlassCard className="p-5 xl:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-blue-500 dark:text-primary" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.matrixTitle}</h4>
          </div>

          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(16rem,1fr)_minmax(10rem,0.32fr)_minmax(10rem,0.32fr)]">
              <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                  {t.searchPolicies}
                </span>
                <div className="mt-1 flex min-h-7 items-center gap-2">
                  <Search className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-white/35" />
                  <input
                    aria-label={t.searchPolicies}
                    className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-white/35"
                    onChange={(event) => setPolicySearch(event.target.value)}
                    placeholder={t.searchPoliciesPlaceholder}
                    type="search"
                    value={policySearch}
                  />
                </div>
              </label>
              <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                  {t.action}
                </span>
                <select
                  aria-label={t.action}
                  className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
                  onChange={(event) => setActionFilter(event.target.value as RoutingActionFilter)}
                  value={actionFilter}
                >
                  <option value="all">{t.allActions}</option>
                  <option value="direct">{t.actionLabels.direct}</option>
                  <option value="proxy">{t.actionLabels.proxy}</option>
                  <option value="reject">{t.actionLabels.reject}</option>
                </select>
              </label>
              <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                  {t.risk}
                </span>
                <select
                  aria-label={t.risk}
                  className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
                  onChange={(event) => setRiskFilter(event.target.value as RoutingRiskFilter)}
                  value={riskFilter}
                >
                  <option value="all">{t.allRisks}</option>
                  <option value="low">{t.riskLabels.low}</option>
                  <option value="medium">{t.riskLabels.medium}</option>
                  <option value="high">{t.riskLabels.high}</option>
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                {t.matchingPolicies} {filteredPolicies.length} / {policies.length}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-white/60">
                  <input
                    aria-label={t.selectVisiblePolicies}
                    checked={filteredPolicies.length > 0 && selectedVisiblePolicyCount === filteredPolicies.length}
                    className="h-4 w-4 rounded border-slate-300 text-cyan-500 focus:ring-cyan-400"
                    onChange={toggleVisiblePolicySelection}
                    type="checkbox"
                  />
                  {t.selectVisiblePolicies}
                </label>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                  {t.selectedPolicies} {formatNumber(selectedPolicies.length, language)}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:bg-white hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
                disabled={taskMutationBusy || selectedPolicies.length === 0}
                onClick={compileSelectedPolicies}
                type="button"
              >
                {t.compileSelectedPolicies}
              </button>
              <button
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:bg-white hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
                disabled={selectedPolicies.length === 0}
                onClick={copySelectedCompilePlan}
                type="button"
              >
                <Copy className="h-3.5 w-3.5" />
                {t.copySelectedCompilePlan}
              </button>
            </div>
          </div>

          {selectedPolicies.length > 0 ? (
            <RoutingCompileImpactPreflight
              language={language}
              selectedCount={selectedPolicies.length}
              summary={selectedCompileImpactSummary}
              t={t}
            />
          ) : null}

          <div aria-label="Filtered Route Policies" className="space-y-3">
            {filteredPolicies.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-5 text-sm font-semibold text-slate-500 dark:border-white/10 dark:text-white/45">
                {t.noMatchingPolicies}
              </div>
            ) : (
              filteredPolicies.map((policy) => (
              <div key={policy.id} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <input
                      aria-label={`${t.selectPolicy} ${policy.name}`}
                      checked={selectedPolicyIds.includes(policy.id)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-cyan-500 focus:ring-cyan-400"
                      onChange={() => togglePolicySelection(policy.id)}
                      type="checkbox"
                    />
                    <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{policy.name}</p>
                    <p className="mt-1 break-all font-mono text-[10px] font-semibold text-blue-600 dark:text-primary">
                      {policy.id}
                    </p>
                    <p className="mt-1 break-all font-mono text-[11px] text-slate-500 dark:text-white/45">
                      {policy.match}
                    </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-600 dark:bg-white/10 dark:text-white/70">
                      {policy.action}
                    </span>
                    <GlassToggle aria-label={`${policy.name} enabled`} checked={policy.enabled} readOnly />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-500 dark:text-white/50 md:grid-cols-3">
                  <span>
                    {t.priority} {policy.priority}
                  </span>
                  <span className="break-all">
                    {t.targetGroup} {policy.targetGroup}
                  </span>
                  <span>
                    {t.hits} {formatNumber(policy.hitCount)}
                  </span>
                </div>
              </div>
              ))
            )}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-500 dark:text-primary" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.submitTitle}</h4>
          </div>
          <p className="text-xs leading-6 text-slate-500 dark:text-white/50">{t.submitDescription}</p>
          <div className="mt-5 space-y-2">
            <Metric icon={Network} label={t.policyCount} value={formatNumber(policies.length)} />
            <Metric icon={Network} label={t.visibleHits} value={formatNumber(visibleHits, language)} />
            <Metric
              icon={ShieldAlert}
              label={t.highRiskRules}
              value={formatNumber(highRiskCount, language)}
            />
          </div>
          <button
            className="mt-5 w-full rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600 transition hover:bg-rose-100 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200"
            onClick={() => setRiskFilter('high')}
            type="button"
          >
            {t.highRiskFilter} · {formatNumber(highRiskCount, language)}
          </button>
          <GlowButton
            className="mt-5 w-full text-xs disabled:cursor-not-allowed disabled:opacity-60"
            disabled={taskMutationBusy || filteredPolicies.length === 0}
            onClick={compileVisiblePolicies}
          >
            {t.compile}
          </GlowButton>
        </GlassCard>
      </section>
    </div>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Network }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-white/10">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <span className="text-sm font-black text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}

function RoutingCompileImpactPreflight({
  language,
  selectedCount,
  summary,
  t
}: {
  language: AppLanguage;
  selectedCount: number;
  summary: RoutingCompileImpactSummary;
  t: RoutingCopy;
}) {
  return (
    <section
      aria-label={t.compileImpactPreflight}
      className="mb-4 rounded-xl border border-cyan-200 bg-cyan-50/60 p-4 dark:border-cyan-300/15 dark:bg-cyan-400/[0.045]"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-cyan-700 dark:text-cyan-200">
            {t.compileImpactPreflight}
          </p>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600 dark:text-white/55">
            {t.compileImpactHint}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.targetGroupLabels.slice(0, 4).map((label) => (
              <span
                className="rounded-full border border-cyan-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 dark:border-cyan-300/20 dark:bg-white/[0.04] dark:text-white/70"
                key={label}
              >
                {label}
              </span>
            ))}
            {summary.targetGroupLabels.length > 4 ? (
              <span className="rounded-full border border-cyan-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500 dark:border-cyan-300/20 dark:bg-white/[0.04] dark:text-white/50">
                +{formatNumber(summary.targetGroupLabels.length - 4, language)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:w-[32rem]">
          <RoutingCompileImpactMetric
            label={t.compileImpactTargets}
            value={formatNumber(summary.targetGroupLabels.length, language)}
          />
          <RoutingCompileImpactMetric
            label={t.compileImpactDirect}
            value={formatNumber(summary.directPolicyCount, language)}
          />
          <RoutingCompileImpactMetric
            label={t.compileImpactProxy}
            value={formatNumber(summary.proxyPolicyCount, language)}
          />
          <RoutingCompileImpactMetric
            label={t.compileImpactReject}
            value={formatNumber(summary.rejectPolicyCount, language)}
          />
          <RoutingCompileImpactMetric label={t.selectedPolicies} value={formatNumber(selectedCount, language)} />
          <RoutingCompileImpactMetric
            label={t.compileImpactRisky}
            value={formatNumber(summary.riskyPolicyCount, language)}
          />
          <RoutingCompileImpactMetric
            label={t.compileImpactSelectedHits}
            value={formatNumber(summary.totalHits, language)}
          />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <RoutingCompileImpactPreview
          title={t.compileImpactTargetPreview}
          values={summary.targetGroupLabels.slice(0, 5)}
        />
        <RoutingCompileImpactPreview
          title={t.compileImpactMatchPreview}
          values={summary.matchLabels.slice(0, 5)}
        />
        <RoutingCompileImpactPreview
          title={t.compileImpactRiskPreview}
          values={
            summary.riskyPolicyLabels.length > 0 ? summary.riskyPolicyLabels.slice(0, 5) : [t.compileImpactNoRisk]
          }
          warning={summary.riskyPolicyLabels.length > 0}
        />
      </div>
    </section>
  );
}

function RoutingCompileImpactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-cyan-200 bg-white/80 px-3 py-2 dark:border-cyan-300/15 dark:bg-white/[0.035]">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <p className="mt-1 break-all text-sm font-black text-slate-900 dark:text-white">{value}</p>
      <span className="sr-only">
        {label} {value}
      </span>
    </div>
  );
}

function RoutingCompileImpactPreview({
  title,
  values,
  warning = false
}: {
  title: string;
  values: string[];
  warning?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-cyan-200 bg-white/70 p-3 dark:border-cyan-300/15 dark:bg-white/[0.025]">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-white/40">{title}</p>
      <div className={warning ? 'mt-2 space-y-1 text-amber-700 dark:text-amber-200' : 'mt-2 space-y-1 text-slate-700 dark:text-white/70'}>
        {values.map((value) => (
          <p className="truncate text-xs font-bold" key={value} title={value}>
            {value}
          </p>
        ))}
      </div>
    </div>
  );
}
