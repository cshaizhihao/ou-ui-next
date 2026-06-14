import { useMemo, useState } from 'react';
import { Copy, GitBranch, Network, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { ResponsivePage, WorkspaceCockpit, WorkspaceCockpitScroller } from '../../components/layout/responsive-page';
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
type RoutingCompileGateState = 'ready' | 'issues' | 'waiting';

const copy = {
  zh: {
    title: '分流策略',
    subtitle: '主机节点 / 访问域名 / 出站协议',
    operationalOverview: '运营总览',
    overviewTotalPolicies: '总策略',
    overviewVisiblePolicies: '可见策略',
    overviewRiskyPolicies: '高风险策略',
    overviewSelectedPolicies: '已选策略',
    matrixTitle: '策略清单',
    priority: '优先级',
    targetGroup: '目标组',
    hits: '命中',
    submitTitle: '策略提交',
    submitDescription: '策略变更任务',
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
    manualRuleTitle: '手写分流规则',
    generatedHost: '生成主机',
    accessDomain: '访问域名',
    outboundProtocol: '出站协议',
    outboundTag: '出站标签',
    manualRuleCompile: '编译手写规则',
    manualNodeSuffix: '生成的节点',
    confirmRiskyCompile: (count: string) => `确认编译 ${count} 条高风险或拒绝策略？`,
    compileImpactPreflight: '路由编译影响预检',
    compileImpactHint: '',
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
    },
    routingPolicyCockpit: '分流策略 cockpit',
    routingControlRail: '分流控制轨',
    routingPolicyWorkspace: '分流策略工作区',
    compileScope: '编译范围',
    policyCompileGates: '策略编译门禁',
    policyCompileGatesHint: '',
    visibleScopeGate: '可见范围',
    visibleScopeGateDetail: (visibleCount: number, totalCount: number, language: AppLanguage) =>
      `${formatNumber(visibleCount, language)} 可见 / ${formatNumber(totalCount, language)} 总策略`,
    riskReviewGate: '风险复核',
    riskReviewGateDetail: (riskyCount: number, language: AppLanguage) =>
      `${formatNumber(riskyCount, language)} 条高风险或拒绝策略需要复核`,
    targetGroupsGate: '目标组',
    targetGroupsGateDetail: (targetGroupCount: number, language: AppLanguage) =>
      `${formatNumber(targetGroupCount, language)} 个目标组进入编译范围`,
    selectionScopeGate: '选择范围',
    selectionScopeGateDetail: (selectedCount: number, language: AppLanguage) =>
      selectedCount > 0 ? `${formatNumber(selectedCount, language)} 条策略已选择` : '未选择单独策略，将使用当前可见范围',
    dispatchReadinessGate: '下发准备度',
    dispatchReadinessGateDetail: '可下发',
    gateStateLabel: {
      ready: '就绪',
      issues: '异常',
      waiting: '等待'
    }
  },
  en: {
    title: 'Routing Policy',
    subtitle: 'Host node / accessed domain / outbound protocol',
    operationalOverview: 'Operational Overview',
    overviewTotalPolicies: 'Total Policies',
    overviewVisiblePolicies: 'Visible Policies',
    overviewRiskyPolicies: 'High-Risk Policies',
    overviewSelectedPolicies: 'Selected Policies',
    matrixTitle: 'Policy List',
    priority: 'Priority',
    targetGroup: 'Target Group',
    hits: 'Hits',
    submitTitle: 'Policy Submission',
    submitDescription: 'Policy change task',
    policyCount: 'Policy Count',
    highRiskRules: 'High Risk Rules',
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
    manualRuleTitle: 'Manual Routing Rule',
    generatedHost: 'Generated Host',
    accessDomain: 'Access Domain',
    outboundProtocol: 'Outbound Protocol',
    outboundTag: 'Outbound Tag',
    manualRuleCompile: 'Compile Manual Rule',
    manualNodeSuffix: 'generated node',
    confirmRiskyCompile: (count: string) =>
      `Compile ${count} high-risk or reject polic${count === '1' ? 'y' : 'ies'}?`,
    compileImpactPreflight: 'Routing Compile Impact Preflight',
    compileImpactHint: '',
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
    },
    routingPolicyCockpit: 'Routing policy cockpit',
    routingControlRail: 'Routing control rail',
    routingPolicyWorkspace: 'Routing policy workspace',
    compileScope: 'Compile Scope',
    policyCompileGates: 'Policy Compile Gates',
    policyCompileGatesHint: '',
    visibleScopeGate: 'Visible Scope',
    visibleScopeGateDetail: (visibleCount: number, totalCount: number, language: AppLanguage) =>
      `${formatNumber(visibleCount, language)} visible / ${formatNumber(totalCount, language)} total policies`,
    riskReviewGate: 'Risk Review',
    riskReviewGateDetail: (riskyCount: number, language: AppLanguage) =>
      `${formatNumber(riskyCount, language)} high-risk or reject policies need review`,
    targetGroupsGate: 'Target Groups',
    targetGroupsGateDetail: (targetGroupCount: number, language: AppLanguage) =>
      `${formatNumber(targetGroupCount, language)} target groups in compile scope`,
    selectionScopeGate: 'Selection Scope',
    selectionScopeGateDetail: (selectedCount: number, language: AppLanguage) =>
      selectedCount > 0 ? `${formatNumber(selectedCount, language)} policies selected` : 'No explicit selection, visible scope will be used',
    dispatchReadinessGate: 'Dispatch Readiness',
    dispatchReadinessGateDetail: 'Ready to dispatch',
    gateStateLabel: {
      ready: 'Ready',
      issues: 'Issues',
      waiting: 'Waiting'
    }
  }
} as const;

type RoutingCopy = (typeof copy)[AppLanguage];
type RoutingCompileGate = {
  detail: string;
  label: string;
  state: RoutingCompileGateState;
  value: string;
};
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

function createRoutingCompileGates({
  filteredPolicies,
  language,
  policies,
  riskyVisiblePolicyCount,
  selectedPolicies,
  t,
  taskMutationBusy
}: {
  filteredPolicies: RoutingPolicy[];
  language: AppLanguage;
  policies: RoutingPolicy[];
  riskyVisiblePolicyCount: number;
  selectedPolicies: RoutingPolicy[];
  t: RoutingCopy;
  taskMutationBusy: boolean;
}): RoutingCompileGate[] {
  const targetGroupCount = new Set(filteredPolicies.map((policy) => policy.targetGroup)).size;
  const visibleScopeState: RoutingCompileGateState = filteredPolicies.length > 0 ? 'ready' : 'issues';
  const riskReviewState: RoutingCompileGateState = riskyVisiblePolicyCount > 0 ? 'issues' : 'ready';
  const targetGroupsState: RoutingCompileGateState = targetGroupCount > 0 ? 'ready' : 'waiting';
  const selectionScopeState: RoutingCompileGateState = selectedPolicies.length > 0 ? 'ready' : 'waiting';
  const dispatchReadinessState: RoutingCompileGateState =
    taskMutationBusy || filteredPolicies.length === 0 ? 'waiting' : 'ready';

  return [
    {
      detail: t.visibleScopeGateDetail(filteredPolicies.length, policies.length, language),
      label: t.visibleScopeGate,
      state: visibleScopeState,
      value: t.gateStateLabel[visibleScopeState]
    },
    {
      detail: t.riskReviewGateDetail(riskyVisiblePolicyCount, language),
      label: t.riskReviewGate,
      state: riskReviewState,
      value: t.gateStateLabel[riskReviewState]
    },
    {
      detail: t.targetGroupsGateDetail(targetGroupCount, language),
      label: t.targetGroupsGate,
      state: targetGroupsState,
      value: t.gateStateLabel[targetGroupsState]
    },
    {
      detail: t.selectionScopeGateDetail(selectedPolicies.length, language),
      label: t.selectionScopeGate,
      state: selectionScopeState,
      value: t.gateStateLabel[selectionScopeState]
    },
    {
      detail: t.dispatchReadinessGateDetail,
      label: t.dispatchReadinessGate,
      state: dispatchReadinessState,
      value: t.gateStateLabel[dispatchReadinessState]
    }
  ];
}

export function RoutingPage({ policies, language, taskMutationBusy = false, onRunTask }: RoutingPageProps) {
  const t = copy[language];
  const [policySearch, setPolicySearch] = useState('');
  const [actionFilter, setActionFilter] = useState<RoutingActionFilter>('all');
  const [riskFilter, setRiskFilter] = useState<RoutingRiskFilter>('all');
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<string[]>([]);
  const [manualHost, setManualHost] = useState('');
  const [manualDomain, setManualDomain] = useState('');
  const [manualOutboundProtocol, setManualOutboundProtocol] = useState<RoutingPolicy['action']>('proxy');
  const [manualOutboundTag, setManualOutboundTag] = useState('');
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
  const compileGates = useMemo(
    () =>
      createRoutingCompileGates({
        filteredPolicies,
        language,
        policies,
        riskyVisiblePolicyCount,
        selectedPolicies,
        t,
        taskMutationBusy
      }),
    [filteredPolicies, language, policies, riskyVisiblePolicyCount, selectedPolicies, t, taskMutationBusy]
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

  function compileManualRule() {
    const host = manualHost.trim();
    const domain = manualDomain.trim();
    const outboundTag =
      manualOutboundTag.trim()
      || (manualOutboundProtocol === 'direct' ? 'DIRECT' : manualOutboundProtocol === 'reject' ? 'REJECT' : 'PROXY');

    if (!host || !domain) {
      return;
    }

    onRunTask('routing-manual-rule', [
      `manual:${host}:${domain}:${manualOutboundProtocol}:${outboundTag}`
    ]);
  }

  return (
    <ResponsivePage className="space-y-3 md:space-y-4">
      <section
        aria-label={t.operationalOverview}
        className="stagger-1 overflow-hidden border border-[#07111F]/25 bg-[#FFFDF5]/92 p-3 shadow-[0_14px_38px_-32px_rgba(7,17,31,0.26)] dark:border-[#6B7CFF]/20 dark:bg-white/[0.03] dark:shadow-black/20"
      >
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(17rem,0.34fr)] xl:items-start">
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-black uppercase tracking-[0.18em] text-[#1E3AFF] dark:text-primary">
              {t.operationalOverview}
            </p>
            <h3 className="mt-2 text-base font-bold text-[#07111F] dark:text-white">{t.title}</h3>
            <p className="mt-1 max-w-4xl text-xs leading-5 text-[#35405A] dark:text-white/50">{t.subtitle}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold text-[#35405A] dark:text-white/65">
              <span className="rounded-full border border-[#07111F]/18 bg-[#EAF3D1]/45 px-2.5 py-1 dark:border-white/10 dark:bg-white/[0.03]">
                {t.overviewTotalPolicies} {formatNumber(policies.length, language)}
              </span>
              <span className="rounded-full border border-[#07111F]/18 bg-[#EAF3D1]/45 px-2.5 py-1 dark:border-white/10 dark:bg-white/[0.03]">
                {t.overviewVisiblePolicies} {formatNumber(filteredPolicies.length, language)}
              </span>
              <span className="rounded-full border border-[#07111F]/18 bg-[#EAF3D1]/45 px-2.5 py-1 dark:border-white/10 dark:bg-white/[0.03]">
                {t.overviewRiskyPolicies} {formatNumber(highRiskCount, language)}
              </span>
              <span className="rounded-full border border-[#07111F]/18 bg-[#EAF3D1]/45 px-2.5 py-1 dark:border-white/10 dark:bg-white/[0.03]">
                {t.overviewSelectedPolicies} {formatNumber(selectedPolicies.length, language)}
              </span>
            </div>
          </div>

          <div className="routing-summary-grid grid min-w-0 grid-cols-2 gap-2 xl:w-[28rem] xl:grid-cols-2">
            <RoutingSummaryCard icon={Network} label={t.overviewTotalPolicies} value={formatNumber(policies.length, language)} />
            <RoutingSummaryCard icon={Search} label={t.overviewVisiblePolicies} value={formatNumber(filteredPolicies.length, language)} />
            <RoutingSummaryCard icon={ShieldAlert} label={t.overviewRiskyPolicies} value={formatNumber(highRiskCount, language)} />
            <RoutingSummaryCard icon={ShieldCheck} label={t.overviewSelectedPolicies} value={formatNumber(selectedPolicies.length, language)} />
          </div>
        </div>
      </section>

      <WorkspaceCockpit aria-label={t.routingPolicyCockpit} className="routing-policy-cockpit stagger-2">
        <div className="routing-policy-cockpit-grid grid min-h-0 grid-cols-1 xl:grid-cols-[18rem_minmax(0,1fr)]">
          <aside
            aria-label={t.routingControlRail}
            className="routing-policy-rail border-b border-[#07111F]/18 bg-[#EAF3D1]/45 p-3 dark:border-white/10 dark:bg-white/[0.02] xl:border-b-0 xl:border-r"
            role="complementary"
          >
            <div className="flex flex-col gap-3 xl:sticky xl:top-0">
              <div className="border border-[#07111F]/18 bg-[#FFFDF5]/82 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="mb-3 flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-[#1E3AFF] dark:text-primary" />
                  <h4 className="text-sm font-bold text-[#07111F] dark:text-white">{t.compileScope}</h4>
                </div>
                <p className="text-xs leading-5 text-[#35405A] dark:text-white/50">{t.submitDescription}</p>
                <div className="mt-3 space-y-2">
                  <Metric icon={Network} label={t.policyCount} value={formatNumber(policies.length)} />
                  <Metric icon={Network} label={t.visibleHits} value={formatNumber(visibleHits, language)} />
                  <Metric
                    icon={ShieldAlert}
                    label={t.highRiskRules}
                    tone="signal"
                    value={formatNumber(highRiskCount, language)}
                  />
                </div>
                <button
                  className="mt-3 w-full border border-[#FF3D18]/35 bg-[#FFD8C6]/70 px-3 py-2 text-xs font-bold text-[#C92810] transition hover:bg-[#FFD8C6] dark:border-[#FFB299]/20 dark:bg-[#FF3D18]/10 dark:text-[#FFB299]"
                  onClick={() => setRiskFilter('high')}
                  type="button"
                >
                  {t.highRiskFilter} · {formatNumber(highRiskCount, language)}
                </button>
                <GlowButton
                  className="mt-3 w-full text-xs disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={taskMutationBusy || filteredPolicies.length === 0}
                  onClick={compileVisiblePolicies}
                >
                  {t.compile}
                </GlowButton>
              </div>

              <RoutingCompileGatePanel gates={compileGates} t={t} />

              <div className="border border-[#07111F]/18 bg-[#FFFDF5]/82 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-[#1E3AFF] dark:text-primary" />
                  <p className="text-sm font-semibold text-[#07111F] dark:text-white">{t.matrixTitle}</p>
                </div>
                <div className="mt-3 grid gap-2">
                  <Metric icon={Search} label={t.matchingPolicies} value={`${formatNumber(filteredPolicies.length, language)} / ${formatNumber(policies.length, language)}`} />
                  <Metric icon={ShieldCheck} label={t.selectedPolicies} value={formatNumber(selectedPolicies.length, language)} />
                </div>
              </div>
            </div>
          </aside>

          <WorkspaceCockpitScroller aria-label={t.routingPolicyWorkspace} className="routing-policy-workspace min-h-0">
            <div className="routing-policy-workspace-stack space-y-3 p-3">
              <section
                aria-label={t.manualRuleTitle}
                className="routing-manual-rule-panel border border-[#07111F]/18 bg-[#FFFDF5] p-3 shadow-[0_12px_34px_-30px_rgba(7,17,31,0.26)] dark:border-white/10 dark:bg-white/[0.035]"
                role="region"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-4 w-4 text-[#1E3AFF] dark:text-primary" />
                      <h4 className="text-sm font-bold text-[#07111F] dark:text-white">{t.manualRuleTitle}</h4>
                    </div>
                    {manualHost.trim() || manualDomain.trim() || manualOutboundTag.trim() ? (
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-black text-[#35405A] dark:text-white/62">
                        <span className="border border-[#07111F]/18 bg-[#EAF3D1]/60 px-2 py-1 dark:border-white/10 dark:bg-white/[0.04]">
                          {manualHost.trim() || '-'} {t.manualNodeSuffix}
                        </span>
                        <span className="border border-[#07111F]/18 bg-[#DCE1FF]/62 px-2 py-1 text-[#1E3AFF] dark:border-[#6B7CFF]/20 dark:bg-[#6B7CFF]/12 dark:text-[#BAC4FF]">
                          domain:{manualDomain.trim() || '-'}
                        </span>
                        <span className="border border-[#07111F]/18 bg-[#FFD8C6]/70 px-2 py-1 text-[#B93C17] dark:border-[#FFB299]/20 dark:bg-[#FF6A3A]/12 dark:text-[#FFB299]">
                          outbound:{manualOutboundTag.trim() || manualOutboundProtocol.toUpperCase()}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <GlowButton
                    className="min-h-10 px-4 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!manualHost.trim() || !manualDomain.trim() || taskMutationBusy}
                    onClick={compileManualRule}
                  >
                    {t.manualRuleCompile}
                  </GlowButton>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(10rem,1fr)_minmax(12rem,1fr)_minmax(10rem,0.7fr)_minmax(10rem,0.8fr)]">
                  <ManualRuleInput label={t.generatedHost} value={manualHost} onChange={setManualHost} />
                  <ManualRuleInput label={t.accessDomain} value={manualDomain} onChange={setManualDomain} />
                  <label className="block border border-[#07111F]/18 bg-[#FFFDF5] px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">
                      {t.outboundProtocol}
                    </span>
                    <select
                      aria-label={t.outboundProtocol}
                      className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-[#07111F] outline-none dark:text-white"
                      onChange={(event) => setManualOutboundProtocol(event.target.value as RoutingPolicy['action'])}
                      value={manualOutboundProtocol}
                    >
                      <option value="direct">{t.actionLabels.direct}</option>
                      <option value="proxy">{t.actionLabels.proxy}</option>
                      <option value="reject">{t.actionLabels.reject}</option>
                    </select>
                  </label>
                  <ManualRuleInput label={t.outboundTag} value={manualOutboundTag} onChange={setManualOutboundTag} />
                </div>
              </section>

              <GlassCard aria-label={t.matrixTitle} className="routing-policy-matrix-panel p-3" role="group">
                <div className="mb-3 flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-[#1E3AFF] dark:text-primary" />
                  <h4 className="text-sm font-bold text-[#07111F] dark:text-white">{t.matrixTitle}</h4>
                </div>

                <div className="routing-policy-filter-panel mb-3 border border-[#07111F]/18 bg-[#EAF3D1]/35 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="routing-policy-filter-grid grid grid-cols-1 gap-3 xl:grid-cols-[minmax(16rem,1fr)_minmax(10rem,0.32fr)_minmax(10rem,0.32fr)]">
                    <label className="block border border-[#07111F]/18 bg-[#FFFDF5] px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">
                        {t.searchPolicies}
                      </span>
                      <div className="mt-1 flex min-h-7 items-center gap-2">
                        <Search className="h-3.5 w-3.5 shrink-0 text-[#35405A]/70 dark:text-white/35" />
                        <input
                          aria-label={t.searchPolicies}
                          className="w-full bg-transparent text-sm font-semibold text-[#07111F] outline-none placeholder:text-[#35405A]/60 dark:text-white dark:placeholder:text-white/35"
                          onChange={(event) => setPolicySearch(event.target.value)}
                          placeholder={t.searchPoliciesPlaceholder}
                          type="search"
                          value={policySearch}
                        />
                      </div>
                    </label>
                    <label className="block border border-[#07111F]/18 bg-[#FFFDF5] px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">
                        {t.action}
                      </span>
                      <select
                        aria-label={t.action}
                        className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-[#07111F] outline-none dark:text-white"
                        onChange={(event) => setActionFilter(event.target.value as RoutingActionFilter)}
                        value={actionFilter}
                      >
                        <option value="all">{t.allActions}</option>
                        <option value="direct">{t.actionLabels.direct}</option>
                        <option value="proxy">{t.actionLabels.proxy}</option>
                        <option value="reject">{t.actionLabels.reject}</option>
                      </select>
                    </label>
                    <label className="block border border-[#07111F]/18 bg-[#FFFDF5] px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">
                        {t.risk}
                      </span>
                      <select
                        aria-label={t.risk}
                        className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-[#07111F] outline-none dark:text-white"
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
                    <p className="text-xs font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">
                      {t.matchingPolicies} {filteredPolicies.length} / {policies.length}
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="inline-flex items-center gap-2 text-xs font-bold text-[#35405A] dark:text-white/60">
                        <input
                          aria-label={t.selectVisiblePolicies}
                          checked={filteredPolicies.length > 0 && selectedVisiblePolicyCount === filteredPolicies.length}
                          className="h-4 w-4 border-[#07111F]/30 text-[#1E3AFF] focus:ring-[#1E3AFF]/35"
                          onChange={toggleVisiblePolicySelection}
                          type="checkbox"
                        />
                        {t.selectVisiblePolicies}
                      </label>
                      <p className="text-xs font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">
                        {t.selectedPolicies} {formatNumber(selectedPolicies.length, language)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="inline-flex min-h-9 items-center justify-center border border-[#07111F]/20 px-3 text-xs font-bold text-[#35405A] transition hover:bg-[#DCE1FF]/55 hover:text-[#1E3AFF] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
                      disabled={taskMutationBusy || selectedPolicies.length === 0}
                      onClick={compileSelectedPolicies}
                      type="button"
                    >
                      {t.compileSelectedPolicies}
                    </button>
                    <button
                      className="inline-flex min-h-9 items-center justify-center gap-2 border border-[#07111F]/20 px-3 text-xs font-bold text-[#35405A] transition hover:bg-[#DCE1FF]/55 hover:text-[#1E3AFF] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
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
                    <div className="border border-dashed border-[#07111F]/30 p-3 text-sm font-semibold text-[#35405A] dark:border-white/10 dark:text-white/45">
                      {t.noMatchingPolicies}
                    </div>
                  ) : (
                    filteredPolicies.map((policy) => (
                      <article
                        aria-label={policy.name}
                        className="routing-policy-row min-h-[64px] border border-[#07111F]/18 px-3 py-2.5 transition-colors hover:bg-[#EAF3D1]/35 dark:border-white/10 dark:hover:bg-white/[0.03]"
                        key={policy.id}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-1 items-start gap-3">
                            <input
                              aria-label={`${t.selectPolicy} ${policy.name}`}
                              checked={selectedPolicyIds.includes(policy.id)}
                              className="mt-0.5 h-4 w-4 shrink-0 border-[#07111F]/30 text-[#1E3AFF] focus:ring-[#1E3AFF]/35"
                              onChange={() => togglePolicySelection(policy.id)}
                              type="checkbox"
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-[#07111F] dark:text-white">{policy.name}</p>
                              <p className="mt-1 break-all font-mono text-[10px] font-semibold text-[#1E3AFF] dark:text-primary">
                                {policy.id}
                              </p>
                              <p className="mt-1 break-all font-mono text-[11px] text-[#35405A] dark:text-white/45">
                                {policy.match}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="rounded-full bg-[#DCE1FF] px-2.5 py-1 text-[10px] font-bold uppercase text-[#1E3AFF] dark:bg-white/10 dark:text-white/70">
                              {policy.action}
                            </span>
                            <GlassToggle aria-label={`${policy.name} enabled`} checked={policy.enabled} readOnly />
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-[#35405A] dark:text-white/50 md:grid-cols-3">
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
                      </article>
                    ))
                  )}
                </div>
              </GlassCard>
            </div>
          </WorkspaceCockpitScroller>
        </div>
      </WorkspaceCockpit>
    </ResponsivePage>
  );
}

function RoutingSummaryCard({
  icon: Icon,
  label,
  value
}: {
  icon: typeof Network;
  label: string;
  value: string;
}) {
  return (
    <div className="routing-summary-card min-h-[64px] border border-[#07111F]/18 bg-[#FFFDF5]/74 p-2.5 dark:border-white/10 dark:bg-black/10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">{label}</p>
          <p className="mt-1 text-base font-black text-[#07111F] dark:text-white">{value}</p>
        </div>
        <Icon className="h-5 w-5 text-[#1E3AFF] dark:text-primary" />
      </div>
    </div>
  );
}

function ManualRuleInput({
  label,
  onChange,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block border border-[#07111F]/18 bg-[#FFFDF5] px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
      <span className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">{label}</span>
      <input
        aria-label={label}
        className="mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-[#07111F] outline-none placeholder:text-[#35405A]/55 dark:text-white dark:placeholder:text-white/35"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  tone = 'neutral'
}: {
  label: string;
  value: string;
  icon: typeof Network;
  tone?: 'neutral' | 'signal';
}) {
  const toneClassName =
    tone === 'signal'
      ? 'border-[#FF3D18] bg-[#FFD8C6]/72 dark:border-[#FF6A3A]/30 dark:bg-[#FF6A3A]/12'
      : 'border-[#07111F]/18 dark:border-white/10';
  const labelClassName =
    tone === 'signal'
      ? 'text-[#B93C17] dark:text-[#FFB197]'
      : 'text-[#35405A] dark:text-white/40';

  return (
    <div
      aria-label={label}
      className={`routing-rail-metric flex min-h-[64px] items-center justify-between border px-3 py-2 ${toneClassName}`}
      role="group"
    >
      <div className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest ${labelClassName}`}>
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <span className="text-sm font-black text-[#07111F] dark:text-white">{value}</span>
    </div>
  );
}

function RoutingCompileGatePanel({ gates, t }: { gates: RoutingCompileGate[]; t: RoutingCopy }) {
  return (
    <section
      aria-label={t.policyCompileGates}
      className="routing-compile-gate-panel overflow-hidden border border-[#07111F] bg-[#FFFDF5] shadow-[0_18px_44px_-38px_rgba(7,17,31,0.42)] dark:border-[#6B7CFF]/30 dark:bg-white/[0.035]"
      role="region"
    >
      <div className="border-b border-[#07111F] bg-[#1E3AFF] px-3 py-2.5 text-white shadow-[inset_0_-3px_0_#D9FF00] dark:border-[#6B7CFF]/30 dark:bg-[#1E3AFF]/80">
        <p className="text-xs font-black uppercase tracking-widest">{t.policyCompileGates}</p>
        {t.policyCompileGatesHint ? (
          <p className="mt-1 text-[11px] leading-5 text-white/82">{t.policyCompileGatesHint}</p>
        ) : null}
      </div>
      <div className="grid grid-cols-1 divide-y divide-[#07111F]/20 dark:divide-[#6B7CFF]/20">
        {gates.map((gate) => (
          <RoutingCompileGateRow gate={gate} key={gate.label} />
        ))}
      </div>
    </section>
  );
}

function RoutingCompileGateRow({ gate }: { gate: RoutingCompileGate }) {
  const stateClass = {
    ready: 'border-[#00A878] bg-[#00A878]/[0.12] text-[#006B50] dark:bg-[#00A878]/[0.14] dark:text-[#7FF3C9]',
    issues: 'border-[#FF3D18] bg-[#FF3D18]/[0.13] text-[#C92810] dark:bg-[#FF6A3A]/[0.12] dark:text-[#FFB299]',
    waiting: 'border-[#D9FF00] bg-[#D9FF00]/[0.24] text-[#425200] dark:bg-[#D9FF00]/[0.12] dark:text-[#EAFF5A]'
  } satisfies Record<RoutingCompileGateState, string>;

  return (
    <article
      aria-label={gate.label}
      className="group relative min-h-[76px] px-3 py-2.5 transition-[background-color,transform] duration-200 ease-out hover:bg-[#EAF3D1]/70 motion-reduce:transition-none dark:hover:bg-white/[0.055]"
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
      className="mb-3 border border-[#FF3D18]/35 bg-[#FFD8C6]/55 p-3 dark:border-[#FFB299]/20 dark:bg-[#FF6A3A]/[0.055]"
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-[#B93C17] dark:text-[#FFB197]">
            {t.compileImpactPreflight}
          </p>
          {t.compileImpactHint ? (
            <p className="mt-1 max-w-3xl text-xs leading-5 text-[#35405A] dark:text-white/55">
              {t.compileImpactHint}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.targetGroupLabels.slice(0, 4).map((label) => (
              <span
                className="rounded-full border border-[#FF3D18]/30 bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-bold text-[#35405A] dark:border-[#FFB299]/20 dark:bg-white/[0.04] dark:text-white/70"
                key={label}
              >
                {label}
              </span>
            ))}
            {summary.targetGroupLabels.length > 4 ? (
              <span className="rounded-full border border-[#FF3D18]/30 bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-bold text-[#35405A] dark:border-[#FFB299]/20 dark:bg-white/[0.04] dark:text-white/50">
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
      <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-3">
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
    <div className="min-w-0 border border-[#FF3D18]/30 bg-[#FFFDF5]/80 px-3 py-2 dark:border-[#FFB299]/15 dark:bg-white/[0.035]">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">{label}</p>
      <p className="mt-1 break-all text-sm font-black text-[#07111F] dark:text-white">{value}</p>
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
    <div className="min-w-0 border border-[#FF3D18]/30 bg-[#FFFDF5]/70 p-3 dark:border-[#FFB299]/15 dark:bg-white/[0.025]">
      <p className="text-[10px] font-black uppercase tracking-widest text-[#35405A] dark:text-white/40">{title}</p>
      <div className={warning ? 'mt-2 space-y-1 text-[#B93C17] dark:text-[#FFB197]' : 'mt-2 space-y-1 text-[#35405A] dark:text-white/70'}>
        {values.map((value) => (
          <p className="truncate text-xs font-bold" key={value} title={value}>
            {value}
          </p>
        ))}
      </div>
    </div>
  );
}
