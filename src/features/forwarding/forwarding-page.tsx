import { useEffect, useMemo, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import {
  ArrowRightLeft,
  CheckCircle2,
  Copy,
  Pause,
  Pencil,
  Play,
  Plus,
  Router,
  Send,
  Trash2
} from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { ConfigDrawer } from '../../components/ui/config-drawer';
import {
  ResponsivePage,
  ResponsiveSection,
  WorkspaceCockpit,
  WorkspaceCockpitScroller
} from '../../components/layout/responsive-page';
import { GlassToggle } from '../../components/ui/glass-toggle';
import { GlowButton } from '../../components/ui/glow-button';
import type {
  Agent,
  BillingDirection,
  ForwardPortBinding,
  ForwardProtocol,
  ForwardStrategy,
  PortAllocationStatus,
  RateLimitDirection,
  RateLimitMode,
  TunnelMode
} from '../../domain';
import { formatBytes, formatNumber } from '../shared/format';

export type ForwardingRuleView = {
  id: string;
  name: string;
  ownerName: string;
  protocol: ForwardProtocol;
  tunnelId: string;
  tunnelName: string;
  sourceAgentId: string;
  entryNodeIds: string[];
  sourceAddress: string;
  listenAddress: string;
  listenPort: number;
  targetAddress: string;
  targetPort: number;
  enabled: boolean;
  portStatus: PortAllocationStatus;
  bindings: ForwardPortBinding[];
  bindingCount: number;
  quotaBytes: number;
  usedBytes: number;
  monthlyResetDay: number;
  currentUsedTrafficGb: number;
  rateLimitMbps: number;
  rateLimitMode: RateLimitMode;
  rateLimitDirection: RateLimitDirection;
  ipRateLimitMbps: number;
  billingDirection: BillingDirection;
  pricePerGb: number;
  tunnelMode: TunnelMode;
  strategy: ForwardStrategy;
  maxConnections: number;
  maxConnectionsPerIp: number;
  proxyProtocol: boolean;
  quotaExceeded?: boolean;
  runtimeDisabledByPolicy?: boolean;
  guardrailReason?: string;
};

export type ForwardingCreateMetadata = {
  name: string;
  ownerName: string;
  tunnelId?: string;
  listenAddress: string;
  listenPort: number;
  targetAddress: string;
  targetPort: number;
  protocol: ForwardProtocol;
  entryNodeIds: string[];
  strategy: ForwardStrategy;
  quotaGb: number;
  monthlyResetDay: number;
  currentUsedTrafficGb: number;
  rateLimitMbps: number;
  rateLimitMode: RateLimitMode;
  rateLimitDirection: RateLimitDirection;
  ipRateLimitMbps: number;
  maxConnections: number;
  maxConnectionsPerIp: number;
  proxyProtocol: boolean;
  billingDirection: BillingDirection;
  tunnelMode: TunnelMode;
  enabled: boolean;
};

export type ForwardingFocusIntent = {
  id: string;
  kind: 'forward.edit';
  targetId: string;
};

type ForwardingPageProps = {
  agents: Agent[];
  focusIntent?: ForwardingFocusIntent;
  language: AppLanguage;
  returnFocusRef?: RefObject<HTMLElement | null>;
  rules: ForwardingRuleView[];
  taskMutationBusy?: boolean;
  onCreateForwarding: (metadata: ForwardingCreateMetadata, action: 'create' | 'update', ruleId?: string) => void;
  onDeleteForwarding: (rule: ForwardingRuleView) => void;
  onRunTask: (id: string, action: 'apply' | 'pause' | 'resume') => void;
};

type ForwardDraft = {
  name: string;
  ownerName: string;
  listenAddress: string;
  listenPort: string;
  targetAddress: string;
  targetPort: string;
  protocol: ForwardProtocol;
  entryNodeIds: string[];
  strategy: ForwardStrategy;
  quotaGb: string;
  monthlyResetDay: string;
  currentUsedTrafficGb: string;
  rateLimitMbps: string;
  rateLimitMode: RateLimitMode;
  rateLimitDirection: RateLimitDirection;
  ipRateLimitMbps: string;
  maxConnections: string;
  maxConnectionsPerIp: string;
  proxyProtocol: boolean;
  billingDirection: BillingDirection;
  tunnelMode: TunnelMode;
  enabled: boolean;
};

type DrawerState =
  | { type: 'closed' }
  | { type: 'create' }
  | { type: 'edit'; ruleId: string };

type RuleStatusFilter = '' | 'enabled' | 'disabled' | PortAllocationStatus;
type ForwardingOverviewMetric = {
  ariaLabel?: string;
  label: string;
  value: string;
  tone?: 'signal';
};
type ForwardingRuntimeReadinessState = 'ready' | 'issues' | 'waiting';
type ForwardingRuntimeReadinessMetric = {
  label: string;
  state: ForwardingRuntimeReadinessState;
  value: string;
};

const RANDOM_LISTEN_PORT_MIN = 20_000;
const RANDOM_LISTEN_PORT_MAX = 60_999;

const copy = {
  zh: {
    title: '端口转发',
    subtitle: '转发规则、入口绑定、配额和运行时状态。',
    forwardingCockpit: '端口转发 cockpit',
    forwardingRulesWorkspace: '转发规则工作区',
    operationalOverview: '运营概览',
    operationalOverviewHint: '',
    totalRules: '规则总数',
    enabledRules: '启用规则',
    entryBindings: '入口绑定',
    riskFlags: '风险标记',
    billingDirectionSummary: '计费方向汇总',
    rulesTab: '转发规则',
    createAction: '创建转发规则',
    editAction: '编辑转发规则',
    drawerDescription: '',
    createHint: '',
    entryEndpointReady: '转发入口已生成',
    copyEntryEndpoint: '复制入口地址',
    advancedOptions: '高级配置',
    advancedHint: '',
    usedQuota: '已用配额',
    billingDirection: '计费方向',
    name: '规则名称',
    tunnel: '转发分组',
    owner: '客户',
    binding: '入口绑定',
    target: '目标端点',
    runtimePath: '运行时路径',
    runtimePathEntry: '入口',
    runtimePathTarget: '目标',
    runtimePathService: '运行服务',
    runtimePathNoService: '等待运行服务',
    policy: '策略',
    quota: '配额',
    limiter: '限速/限连',
    actions: '操作',
    searchRules: '搜索转发规则',
    searchRulesPlaceholder: '搜索规则、客户、端口、目标、入口主机或状态',
    ruleStatus: '规则状态',
    allStatuses: '全部状态',
    matchingRules: '当前匹配',
    noMatchingRules: '没有匹配的转发规则',
    selectVisibleRules: '选择当前结果',
    selectRule: (name: string) => `选择 ${name}`,
    selectedRules: '已选转发规则',
    bulkMigrateEntryHost: '批量迁移入口主机',
    bulkMigrateEntry: '批量迁移入口',
    bulkApply: '批量应用',
    bulkPause: '批量停用',
    bulkResume: '批量恢复',
    bulkDelete: '批量删除',
    forwardingBulkImpactPreflight: '转发批量影响预检',
    forwardingBulkImpactHint: '',
    forwardingBulkImpactCustomers: '受影响客户',
    forwardingBulkImpactEntryHosts: '入口主机',
    forwardingBulkImpactPortBindings: '端口绑定',
    forwardingBulkImpactUsedTraffic: '已用流量',
    forwardingBulkImpactGuardrailRisks: '守护风险',
    forwardingBulkImpactPausedDisabled: '停用/禁用',
    forwardingBulkImpactCustomerPreview: '客户预览',
    forwardingBulkImpactBindingPreview: '绑定预览',
    forwardingBulkImpactRiskPreview: '风险提示',
    forwardingBulkImpactNoRisk: '暂无守护或端口风险',
    runtimeReadiness: '运行时就绪度',
    runtimeReadinessHint: '',
    runtimeReadinessReady: '就绪',
    runtimeReadinessIssues: '异常',
    runtimeReadinessWaiting: '等待',
    runtimeEvidence: '运行时证据',
    runtimeEvidenceForRule: (name: string) => `${name} 的运行时证据`,
    runtimeEvidenceBindings: (count: string) => `绑定 ${count}`,
    runtimeEvidenceNextAction: (action: string) => `下一步 ${action}`,
    runtimeEvidenceGuardrail: (reason: string) => `守护 ${reason}`,
    runtimeEvidenceNoGuardrail: '守护正常',
    runtimeEvidenceNoService: '尚无运行时服务',
    confirmBulkDelete: (count: string) => `确认删除 ${count} 条规则`,
    confirmBulkMigrateEntry: (count: string, agent: string) => `确认将 ${count} 条已选转发规则迁移到 ${agent}？`,
    confirmBulkRuntimeAction: (action: string, count: string) => `确认${action} ${count} 条转发规则？`,
    confirmRowRuntimeAction: (action: string, name: string) => `确认${action} ${name}？`,
    confirmRowDelete: (name: string) => `确认删除规则 ${name}？`,
    applyPolicy: '应用',
    pausePolicy: '停用',
    resumePolicy: '恢复',
    deleteRule: '删除规则',
    noRules: '暂无转发规则',
    listenAddress: '监听地址',
    listenPort: '监听端口',
    targetAddress: '目标 IP',
    targetPort: '目标端口',
    protocol: '协议',
    entryNodes: '入口主机',
    strategy: '调度策略',
    quotaGb: '流量配额',
    monthlyResetDay: '重置日期',
    currentUsedTraffic: '当前已用流量',
    currentUsedTrafficHint: '',
    rateLimitMbps: '规则限速',
    rateLimitMode: '限速模式',
    rateLimitDirection: '限速方向',
    runtimeLimitsHint: '',
    portConflictTitle: '端口冲突',
    portConflictHint: '当前入口绑定已被现有转发规则占用，请更换入口主机、监听端口、协议或监听地址后再保存。',
    portConflictBinding: (agent: string, endpoint: string, rule: string) => `${agent} / ${endpoint} 已被 ${rule} 占用`,
    quotaSuspended: '配额停用',
    quotaExceeded: '配额超限',
    tunnelMode: '转发类型',
    save: '保存',
    cancel: '取消',
    enabled: '启用',
    selected: '已选',
    unitGb: 'GB',
    unitMbps: 'Mbps',
    billingOptions: {
      both: '双向（入站 + 出站）',
      single: '单向（自动取较大方向）',
      ingress: '入站',
      egress: '出站'
    },
    billingShortOptions: {
      both: '双向',
      single: '单向',
      ingress: '入站',
      egress: '出站'
    },
    rateLimitModeOptions: {
      'bi-directional': '双向',
      'one-way': '单向'
    },
    rateLimitDirectionOptions: {
      both: '双向',
      ingress: '入站',
      egress: '出站'
    },
    strategyOptions: {
      fifo: '顺序',
      'round-robin': '轮询',
      'least-latency': '最低延迟',
      weighted: '权重'
    },
    tunnelModeOptions: {
      direct: '端口转发'
    },
    ruleStateLabels: {
      enabled: '已启用',
      disabled: '已停用'
    },
    portStatusLabels: {
      deploying: '部署中',
      allocated: '已分配',
      paused: '已停用',
      conflict: '端口冲突',
      releasing: '释放中',
      failed: '失败'
    }
  },
  en: {
    title: 'Port Forwarding',
    subtitle: 'Forward rules, entry bindings, quota, and runtime state.',
    forwardingCockpit: 'Port forwarding cockpit',
    forwardingRulesWorkspace: 'Forwarding rules workspace',
    operationalOverview: 'Operational Overview',
    operationalOverviewHint: '',
    totalRules: 'Total rules',
    enabledRules: 'Enabled rules',
    entryBindings: 'Entry bindings',
    riskFlags: 'Risk flags',
    billingDirectionSummary: 'Billing direction summary',
    rulesTab: 'Forward Rules',
    createAction: 'Create Forward Rule',
    editAction: 'Edit Forward Rule',
    drawerDescription: '',
    createHint: '',
    entryEndpointReady: 'Entry endpoint ready',
    copyEntryEndpoint: 'Copy Entry Endpoint',
    advancedOptions: 'Advanced Config',
    advancedHint: '',
    usedQuota: 'Used Quota',
    billingDirection: 'Billing Direction',
    name: 'Rule Name',
    tunnel: 'Forward Group',
    owner: 'Customer',
    binding: 'Entry Binding',
    target: 'Target Endpoint',
    runtimePath: 'Runtime Path',
    runtimePathEntry: 'Entry',
    runtimePathTarget: 'Target',
    runtimePathService: 'Runtime Service',
    runtimePathNoService: 'Pending runtime service',
    policy: 'Policy',
    quota: 'Quota',
    limiter: 'Limiters',
    actions: 'Actions',
    searchRules: 'Search Forward Rules',
    searchRulesPlaceholder: 'Search rule, customer, port, target, entry host, or status',
    ruleStatus: 'Rule Status',
    allStatuses: 'All Statuses',
    matchingRules: 'Matching',
    noMatchingRules: 'No matching forwarding rules',
    selectVisibleRules: 'Select Visible Rules',
    selectRule: (name: string) => `Select ${name}`,
    selectedRules: 'Selected Rules',
    bulkMigrateEntryHost: 'Bulk Migrate Entry Host',
    bulkMigrateEntry: 'Bulk Migrate Entry',
    bulkApply: 'Bulk Deploy',
    bulkPause: 'Bulk Pause',
    bulkResume: 'Bulk Resume',
    bulkDelete: 'Bulk Delete',
    forwardingBulkImpactPreflight: 'Forwarding Bulk Impact Preflight',
    forwardingBulkImpactHint: '',
    forwardingBulkImpactCustomers: 'Affected Customers',
    forwardingBulkImpactEntryHosts: 'Entry Hosts',
    forwardingBulkImpactPortBindings: 'Port Bindings',
    forwardingBulkImpactUsedTraffic: 'Used Traffic',
    forwardingBulkImpactGuardrailRisks: 'Guardrail Risks',
    forwardingBulkImpactPausedDisabled: 'Paused/Disabled',
    forwardingBulkImpactCustomerPreview: 'Customer Preview',
    forwardingBulkImpactBindingPreview: 'Binding Preview',
    forwardingBulkImpactRiskPreview: 'Risk Notes',
    forwardingBulkImpactNoRisk: 'No guardrail or port risks',
    runtimeReadiness: 'Runtime Readiness',
    runtimeReadinessHint: '',
    runtimeReadinessReady: 'Ready',
    runtimeReadinessIssues: 'Issues',
    runtimeReadinessWaiting: 'Waiting',
    runtimeEvidence: 'Runtime Evidence',
    runtimeEvidenceForRule: (name: string) => `Runtime evidence for ${name}`,
    runtimeEvidenceBindings: (count: string) => `Bindings ${count}`,
    runtimeEvidenceNextAction: (action: string) => `Next Action ${action}`,
    runtimeEvidenceGuardrail: (reason: string) => `Guardrail ${reason}`,
    runtimeEvidenceNoGuardrail: 'Guardrail clear',
    runtimeEvidenceNoService: 'No runtime service yet',
    confirmBulkDelete: (count: string) => `Confirm Delete ${count} Rules`,
    confirmBulkMigrateEntry: (count: string, agent: string) =>
      `Migrate ${count} selected forwarding rule${count === '1' ? '' : 's'} to ${agent}?`,
    confirmBulkRuntimeAction: (action: string, count: string) =>
      `${action} ${count} selected forwarding rule${count === '1' ? '' : 's'}?`,
    confirmRowRuntimeAction: (action: string, name: string) => `${action} ${name}?`,
    confirmRowDelete: (name: string) => `Delete Rule ${name}?`,
    applyPolicy: 'Deploy',
    pausePolicy: 'Pause',
    resumePolicy: 'Resume',
    deleteRule: 'Delete Rule',
    noRules: 'No forwarding rules yet',
    listenAddress: 'Listen Address',
    listenPort: 'Listen Port',
    targetAddress: 'Target IP',
    targetPort: 'Target Port',
    protocol: 'Protocol',
    entryNodes: 'Entry Hosts',
    strategy: 'Strategy',
    quotaGb: 'Traffic Quota',
    monthlyResetDay: 'Reset Day',
    currentUsedTraffic: 'Current Used Traffic',
    currentUsedTrafficHint: '',
    rateLimitMbps: 'Rule Rate',
    rateLimitMode: 'Rate Mode',
    rateLimitDirection: 'Rate Direction',
    runtimeLimitsHint: '',
    portConflictTitle: 'Port conflict',
    portConflictHint: 'The selected entry binding is already used by an existing forwarding rule. Change entry host, listen port, protocol, or listen address before saving.',
    portConflictBinding: (agent: string, endpoint: string, rule: string) => `${agent} / ${endpoint} is already used by ${rule}`,
    quotaSuspended: 'Quota suspended',
    quotaExceeded: 'Quota exceeded',
    tunnelMode: 'Forward Type',
    save: 'Save',
    cancel: 'Cancel',
    enabled: 'Enabled',
    selected: 'Selected',
    unitGb: 'GB',
    unitMbps: 'Mbps',
    billingOptions: {
      both: 'Both (Ingress + Egress)',
      single: 'One-way (Higher Direction)',
      ingress: 'Ingress',
      egress: 'Egress'
    },
    billingShortOptions: {
      both: 'Both',
      single: 'One-way',
      ingress: 'In',
      egress: 'Out'
    },
    rateLimitModeOptions: {
      'bi-directional': 'Bi-directional',
      'one-way': 'One-way'
    },
    rateLimitDirectionOptions: {
      both: 'Both',
      ingress: 'Ingress',
      egress: 'Egress'
    },
    strategyOptions: {
      fifo: 'FIFO',
      'round-robin': 'Round Robin',
      'least-latency': 'Least Latency',
      weighted: 'Weighted'
    },
    tunnelModeOptions: {
      direct: 'Port Forward'
    },
    ruleStateLabels: {
      enabled: 'Enabled',
      disabled: 'Disabled'
    },
    portStatusLabels: {
      deploying: 'Deploying',
      allocated: 'Allocated',
      paused: 'Paused',
      conflict: 'Conflict',
      releasing: 'Releasing',
      failed: 'Failed'
    }
  }
} as const;

function createDraft(agents: Agent[]): ForwardDraft {
  return {
    name: '',
    ownerName: '',
    listenAddress: '0.0.0.0',
    listenPort: '',
    targetAddress: '',
    targetPort: '',
    protocol: 'tcp+udp',
    entryNodeIds: agents.slice(0, 2).map((agent) => agent.id),
    strategy: 'round-robin',
    quotaGb: '',
    monthlyResetDay: '1',
    currentUsedTrafficGb: '',
    rateLimitMbps: '',
    rateLimitMode: 'bi-directional',
    rateLimitDirection: 'both',
    ipRateLimitMbps: '',
    maxConnections: '',
    maxConnectionsPerIp: '',
    proxyProtocol: false,
    billingDirection: 'both',
    tunnelMode: 'direct',
    enabled: true
  };
}

function clampResetDay(day: number) {
  return Math.min(Math.max(Math.round(day), 1), 31);
}

function parseNonNegativeNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

function parsePort(value: string) {
  if (!/^\d+$/.test(value.trim())) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return parsed >= 1 && parsed <= 65_535 ? parsed : undefined;
}

function normalizeListenAddress(value: string) {
  return value.trim() || '0.0.0.0';
}

function listenAddressesOverlap(first: string, second: string) {
  const firstAddress = normalizeListenAddress(first);
  const secondAddress = normalizeListenAddress(second);
  const wildcardAddresses = new Set(['0.0.0.0', '::', '*']);

  return firstAddress === secondAddress || wildcardAddresses.has(firstAddress) || wildcardAddresses.has(secondAddress);
}

function protocolsOverlap(first: ForwardProtocol, second: ForwardProtocol) {
  return first === second || first === 'tcp+udp' || second === 'tcp+udp';
}

function readRandomPortOffset(range: number) {
  const cryptoObject = globalThis.crypto;

  if (cryptoObject?.getRandomValues) {
    const values = new Uint32Array(1);
    cryptoObject.getRandomValues(values);
    return values[0] % range;
  }

  return Math.floor(Math.random() * range);
}

function allocateRandomHighListenPort(
  rules: ForwardingRuleView[],
  entryNodeIds: string[],
  protocol: ForwardProtocol,
  listenAddress: string
) {
  const selectedAgentIds = new Set(entryNodeIds);
  const usedPorts = new Set<number>();

  rules.forEach((rule) => {
    rule.bindings.forEach((binding) => {
      if (
        selectedAgentIds.has(binding.agentId) &&
        protocolsOverlap(binding.protocol, protocol) &&
        listenAddressesOverlap(binding.listenAddress, listenAddress)
      ) {
        usedPorts.add(binding.listenPort);
      }
    });
  });

  const range = RANDOM_LISTEN_PORT_MAX - RANDOM_LISTEN_PORT_MIN + 1;

  for (let attempt = 0; attempt < 128; attempt += 1) {
    const port = RANDOM_LISTEN_PORT_MIN + readRandomPortOffset(range);

    if (!usedPorts.has(port)) {
      return port;
    }
  }

  for (let port = RANDOM_LISTEN_PORT_MIN; port <= RANDOM_LISTEN_PORT_MAX; port += 1) {
    if (!usedPorts.has(port)) {
      return port;
    }
  }

  return RANDOM_LISTEN_PORT_MIN;
}

function createDefaultForwardingName(draft: ForwardDraft, listenPort: number, targetPort: number) {
  const owner = draft.ownerName.trim() || 'Customer';
  const target = draft.targetAddress.trim() || 'target';
  return `${owner} ${listenPort}->${target}:${targetPort}`;
}

function formatBillingDirectionSummary(rules: ForwardingRuleView[], t: (typeof copy)['zh' | 'en']) {
  if (rules.length === 0) {
    return '-';
  }

  const counts = rules.reduce<Record<BillingDirection, number>>(
    (summary, rule) => ({
      ...summary,
      [rule.billingDirection]: summary[rule.billingDirection] + 1
    }),
    {
      both: 0,
      single: 0,
      ingress: 0,
      egress: 0
    }
  );

  return (Object.keys(counts) as BillingDirection[])
    .filter((direction) => counts[direction] > 0)
    .map((direction) => `${t.billingShortOptions[direction]} ${counts[direction]}`)
    .join(' · ');
}

function normalizeRuleSearch(value: string) {
  return value.trim().toLowerCase();
}

function createForwardRuleSearchText(rule: ForwardingRuleView, agents: Agent[]) {
  const entryAgentNames = rule.entryNodeIds.flatMap((agentId) => {
    const agent = agents.find((item) => item.id === agentId);

    return agent ? [agent.name, agent.region, agent.publicAddress] : [agentId];
  });

  return [
    rule.id,
    rule.name,
    rule.ownerName,
    rule.protocol,
    rule.tunnelId,
    rule.tunnelName,
    rule.sourceAgentId,
    rule.sourceAddress,
    rule.listenAddress,
    rule.listenPort,
    rule.targetAddress,
    rule.targetPort,
    rule.portStatus,
    rule.enabled ? 'enabled' : 'disabled',
    rule.strategy,
    rule.billingDirection,
    rule.tunnelMode,
    rule.guardrailReason ?? '',
    ...entryAgentNames,
    ...rule.bindings.flatMap((binding) => [
      binding.agentId,
      binding.listenAddress,
      binding.listenPort,
      binding.targetAddress,
      binding.targetPort,
      binding.protocol,
      binding.status,
      ...(binding.runtimeServiceNames ?? [])
    ])
  ].join(' ');
}

function filterForwardingRules(
  rules: ForwardingRuleView[],
  agents: Agent[],
  query: string,
  status: RuleStatusFilter
) {
  const normalizedQuery = normalizeRuleSearch(query);

  return rules.filter((rule) => {
    const matchesStatus =
      !status ||
      (status === 'enabled' ? rule.enabled : status === 'disabled' ? !rule.enabled : rule.portStatus === status);
    const matchesQuery = !normalizedQuery || createForwardRuleSearchText(rule, agents).toLowerCase().includes(normalizedQuery);

    return matchesStatus && matchesQuery;
  });
}

type ForwardingBulkImpactSummary = {
  customerLabels: string[];
  entryHostLabels: string[];
  bindingLabels: string[];
  usedBytes: number;
  guardrailRisks: string[];
  pausedOrDisabledCount: number;
};

function createForwardingBulkImpactSummary(
  rules: ForwardingRuleView[],
  agents: Agent[],
  t: (typeof copy)['zh' | 'en']
): ForwardingBulkImpactSummary {
  const customerLabels = new Set<string>();
  const entryHostLabels = new Set<string>();
  const bindingLabels = new Set<string>();
  const guardrailRisks: string[] = [];
  let usedBytes = 0;
  let pausedOrDisabledCount = 0;

  rules.forEach((rule) => {
    customerLabels.add(rule.ownerName || rule.name);
    usedBytes += Math.max(rule.usedBytes, 0);

    if (!rule.enabled || rule.portStatus === 'paused') {
      pausedOrDisabledCount += 1;
    }

    if (rule.quotaExceeded || rule.runtimeDisabledByPolicy || rule.portStatus === 'conflict' || rule.portStatus === 'failed') {
      const reason =
        rule.guardrailReason ||
        (rule.portStatus === 'conflict' || rule.portStatus === 'failed'
          ? t.portStatusLabels[rule.portStatus]
          : rule.quotaExceeded
            ? t.quotaExceeded
            : t.quotaSuspended);
      guardrailRisks.push(`${rule.name}: ${reason}`);
    }

    rule.bindings.forEach((binding) => {
      const agentName = agents.find((agent) => agent.id === binding.agentId)?.name ?? binding.agentId;
      entryHostLabels.add(agentName);
      bindingLabels.add(
        `${agentName} ${normalizeListenAddress(binding.listenAddress)}:${binding.listenPort}/${binding.protocol}`
      );
    });
  });

  return {
    customerLabels: Array.from(customerLabels),
    entryHostLabels: Array.from(entryHostLabels),
    bindingLabels: Array.from(bindingLabels),
    usedBytes,
    guardrailRisks,
    pausedOrDisabledCount
  };
}

function getForwardingRuntimeReadinessState(rule: ForwardingRuleView): ForwardingRuntimeReadinessState {
  if (
    rule.quotaExceeded ||
    rule.runtimeDisabledByPolicy ||
    Boolean(rule.guardrailReason) ||
    rule.portStatus === 'conflict' ||
    rule.portStatus === 'failed'
  ) {
    return 'issues';
  }

  const hasRuntimeService = rule.bindings.some((binding) => (binding.runtimeServiceNames ?? []).length > 0);

  if (!rule.enabled || !hasRuntimeService || ['deploying', 'paused', 'releasing'].includes(rule.portStatus)) {
    return 'waiting';
  }

  return 'ready';
}

function createForwardingRuntimeReadinessMetrics(
  rules: ForwardingRuleView[],
  language: AppLanguage,
  t: (typeof copy)['zh' | 'en']
): ForwardingRuntimeReadinessMetric[] {
  const counts: Record<ForwardingRuntimeReadinessState, number> = {
    ready: 0,
    issues: 0,
    waiting: 0
  };

  rules.forEach((rule) => {
    counts[getForwardingRuntimeReadinessState(rule)] += 1;
  });

  return [
    {
      label: t.runtimeReadinessReady,
      state: 'ready',
      value: formatNumber(counts.ready, language)
    },
    {
      label: t.runtimeReadinessIssues,
      state: 'issues',
      value: formatNumber(counts.issues, language)
    },
    {
      label: t.runtimeReadinessWaiting,
      state: 'waiting',
      value: formatNumber(counts.waiting, language)
    }
  ];
}

function createDraftFromRule(rule: ForwardingRuleView): ForwardDraft {
  return {
    name: rule.name,
    ownerName: rule.ownerName,
    listenAddress: rule.listenAddress,
    listenPort: String(rule.listenPort),
    targetAddress: rule.targetAddress,
    targetPort: String(rule.targetPort),
    protocol: rule.protocol,
    entryNodeIds: rule.entryNodeIds.length > 0 ? rule.entryNodeIds : [rule.sourceAgentId],
    strategy: rule.strategy,
    quotaGb: String(Math.round(rule.quotaBytes / 1024 / 1024 / 1024)),
    monthlyResetDay: String(rule.monthlyResetDay),
    currentUsedTrafficGb: String(rule.currentUsedTrafficGb),
    rateLimitMbps: String(rule.rateLimitMbps),
    rateLimitMode: rule.rateLimitMode,
    rateLimitDirection:
      rule.rateLimitMode === 'bi-directional' ? 'both' : rule.rateLimitDirection === 'both' ? 'ingress' : rule.rateLimitDirection,
    ipRateLimitMbps: '',
    maxConnections: '',
    maxConnectionsPerIp: '',
    proxyProtocol: false,
    billingDirection: rule.billingDirection,
    tunnelMode: rule.tunnelMode,
    enabled: rule.enabled
  };
}

function createForwardingMetadataFromRule(rule: ForwardingRuleView, entryNodeIds = rule.entryNodeIds): ForwardingCreateMetadata {
  return {
    name: rule.name,
    ownerName: rule.ownerName,
    tunnelId: rule.tunnelId,
    listenAddress: rule.listenAddress,
    listenPort: rule.listenPort,
    targetAddress: rule.targetAddress,
    targetPort: rule.targetPort,
    protocol: rule.protocol,
    entryNodeIds: entryNodeIds.length > 0 ? entryNodeIds : [rule.sourceAgentId],
    strategy: rule.strategy,
    quotaGb: Math.max(Math.round(rule.quotaBytes / 1024 / 1024 / 1024), 0),
    monthlyResetDay: clampResetDay(rule.monthlyResetDay),
    currentUsedTrafficGb: Math.max(rule.currentUsedTrafficGb, 0),
    rateLimitMbps: Math.max(rule.rateLimitMbps, 0),
    rateLimitMode: rule.rateLimitMode,
    rateLimitDirection: rule.rateLimitDirection,
    ipRateLimitMbps: Math.max(rule.ipRateLimitMbps, 0),
    maxConnections: Math.max(rule.maxConnections, 0),
    maxConnectionsPerIp: Math.max(rule.maxConnectionsPerIp, 0),
    proxyProtocol: rule.proxyProtocol,
    billingDirection: rule.billingDirection,
    tunnelMode: rule.tunnelMode,
    enabled: rule.enabled
  };
}

export function ForwardingPage({
  agents,
  focusIntent,
  language,
  returnFocusRef,
  rules,
  taskMutationBusy = false,
  onCreateForwarding,
  onDeleteForwarding,
  onRunTask
}: ForwardingPageProps) {
  const t = copy[language];
  const [drawer, setDrawer] = useState<DrawerState>({ type: 'closed' });
  const [removedRuleIds, setRemovedRuleIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<ForwardDraft>(() => createDraft(agents));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [ruleSearch, setRuleSearch] = useState('');
  const [ruleStatusFilter, setRuleStatusFilter] = useState<RuleStatusFilter>('');
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>([]);
  const [bulkDeleteConfirming, setBulkDeleteConfirming] = useState(false);
  const [bulkMigrateEntryNodeId, setBulkMigrateEntryNodeId] = useState(() => agents[0]?.id ?? '');
  const [lastEntryEndpoints, setLastEntryEndpoints] = useState<string[]>([]);
  const visibleRules = useMemo(
    () => rules.filter((rule) => !removedRuleIds.includes(rule.id)),
    [removedRuleIds, rules]
  );
  const filteredRules = filterForwardingRules(visibleRules, agents, ruleSearch, ruleStatusFilter);
  const selectedRules = visibleRules.filter((rule) => selectedRuleIds.includes(rule.id));
  const selectedVisibleCount = filteredRules.filter((rule) => selectedRuleIds.includes(rule.id)).length;
  const forwardingBulkImpactSummary = useMemo(
    () => createForwardingBulkImpactSummary(selectedRules, agents, t),
    [agents, selectedRules, t]
  );
  const bulkMigrationConflicts = useMemo(() => {
    if (selectedRules.length === 0 || !bulkMigrateEntryNodeId) {
      return [];
    }

    const selectedRuleIdsSet = new Set(selectedRules.map((rule) => rule.id));
    const targetAgentName = agents.find((agent) => agent.id === bulkMigrateEntryNodeId)?.name ?? bulkMigrateEntryNodeId;

    return selectedRules.flatMap((selectedRule) =>
      visibleRules
        .filter((candidateRule) => !selectedRuleIdsSet.has(candidateRule.id))
        .flatMap((candidateRule) =>
          candidateRule.bindings
            .filter(
              (binding) =>
                binding.agentId === bulkMigrateEntryNodeId &&
                binding.listenPort === selectedRule.listenPort &&
                protocolsOverlap(binding.protocol, selectedRule.protocol) &&
                listenAddressesOverlap(binding.listenAddress, selectedRule.listenAddress)
            )
            .map((binding) => ({
              agentName: targetAgentName,
              endpoint: `${normalizeListenAddress(binding.listenAddress)}:${binding.listenPort}/${binding.protocol}`,
              ruleName: candidateRule.name
            }))
        )
    );
  }, [agents, bulkMigrateEntryNodeId, selectedRules, visibleRules]);
  const hasBulkMigrationConflict = bulkMigrationConflicts.length > 0;
  const enabledCount = visibleRules.filter((rule) => rule.enabled).length;
  const bindingCount = visibleRules.reduce((sum, rule) => sum + rule.bindingCount, 0);
  const riskFlagCount = visibleRules.filter(
    (rule) => rule.quotaExceeded || rule.runtimeDisabledByPolicy || rule.portStatus === 'conflict' || Boolean(rule.guardrailReason)
  ).length;
  const editingRule = drawer.type === 'edit' ? visibleRules.find((rule) => rule.id === drawer.ruleId) : undefined;
  const listenPort = parsePort(draft.listenPort);
  const targetPort = parsePort(draft.targetPort);
  const draftListenAddress = normalizeListenAddress(draft.listenAddress);
  const canAutoAllocateListenPort = drawer.type === 'create' && draft.listenPort.trim() === '';
  const conflictingBindings = useMemo(() => {
    if (drawer.type === 'closed' || listenPort === undefined || draft.entryNodeIds.length === 0) {
      return [];
    }

    const selectedAgentIds = new Set(draft.entryNodeIds);

    return visibleRules.flatMap((rule) => {
      if (editingRule?.id === rule.id) {
        return [];
      }

      return rule.bindings
        .filter(
          (binding) =>
            selectedAgentIds.has(binding.agentId) &&
            binding.listenPort === listenPort &&
            protocolsOverlap(binding.protocol, draft.protocol) &&
            listenAddressesOverlap(binding.listenAddress, draftListenAddress)
        )
        .map((binding) => ({
          agentName: agents.find((agent) => agent.id === binding.agentId)?.name ?? binding.agentId,
          endpoint: `${normalizeListenAddress(binding.listenAddress)}:${binding.listenPort}/${binding.protocol}`,
          ruleName: rule.name
        }));
    });
  }, [agents, draft.entryNodeIds, draft.protocol, draftListenAddress, drawer.type, editingRule?.id, listenPort, visibleRules]);
  const hasPortConflict = conflictingBindings.length > 0;
  const canSubmitRule =
    draft.entryNodeIds.length > 0 &&
    Boolean(draft.targetAddress.trim()) &&
    (listenPort !== undefined || canAutoAllocateListenPort) &&
    targetPort !== undefined &&
    !hasPortConflict;
  const rateLimitDirectionOptions =
    draft.rateLimitMode === 'one-way'
      ? [
          { label: t.rateLimitDirectionOptions.ingress, value: 'ingress' },
          { label: t.rateLimitDirectionOptions.egress, value: 'egress' }
      ]
      : [{ label: t.rateLimitDirectionOptions.both, value: 'both' }];
  const overviewMetrics = useMemo<ForwardingOverviewMetric[]>(
    () => [
    {
      label: t.totalRules,
      value: formatNumber(visibleRules.length, language)
    },
    {
      label: t.enabledRules,
      value: `${formatNumber(enabledCount, language)}/${formatNumber(visibleRules.length, language)}`
    },
    {
      label: t.entryBindings,
      value: formatNumber(bindingCount, language)
    },
    {
      label: t.riskFlags,
      value: formatNumber(riskFlagCount, language),
      tone: 'signal'
    },
    {
      ariaLabel: t.billingDirectionSummary,
      label: t.billingDirection,
      value: formatBillingDirectionSummary(visibleRules, t)
    }
  ],
    [bindingCount, enabledCount, language, riskFlagCount, t, visibleRules]
  );
  const runtimeReadinessMetrics = useMemo(
    () => createForwardingRuntimeReadinessMetrics(visibleRules, language, t),
    [language, t, visibleRules]
  );

  useEffect(() => {
    setDraft((current) => {
      const availableIds = new Set(agents.map((agent) => agent.id));
      const retained = current.entryNodeIds.filter((agentId) => availableIds.has(agentId));

      return {
        ...current,
        entryNodeIds: retained.length > 0 ? retained : agents.slice(0, 2).map((agent) => agent.id)
      };
    });

    setBulkMigrateEntryNodeId((current) => {
      if (agents.some((agent) => agent.id === current)) {
        return current;
      }

      return agents[0]?.id ?? '';
    });
  }, [agents]);

  function openCreateDrawer() {
    setDraft(createDraft(agents));
    setAdvancedOpen(false);
    setLastEntryEndpoints([]);
    setDrawer({ type: 'create' });
  }

  function openEditDrawer(rule: ForwardingRuleView) {
    setDraft(createDraftFromRule(rule));
    setAdvancedOpen(false);
    setLastEntryEndpoints([]);
    setDrawer({ type: 'edit', ruleId: rule.id });
  }

  useEffect(() => {
    if (!focusIntent || focusIntent.kind !== 'forward.edit') {
      return;
    }

    const rule = visibleRules.find((item) => item.id === focusIntent.targetId);

    if (!rule) {
      return;
    }

    setRuleSearch('');
    setRuleStatusFilter('');
    openEditDrawer(rule);
  }, [focusIntent, visibleRules]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const resolvedListenPort =
      listenPort ?? allocateRandomHighListenPort(visibleRules, draft.entryNodeIds, draft.protocol, draftListenAddress);

    if (!canSubmitRule || resolvedListenPort === undefined || targetPort === undefined) {
      return;
    }

    const rateLimitDirection =
      draft.rateLimitMode === 'bi-directional' ? 'both' : draft.rateLimitDirection === 'egress' ? 'egress' : 'ingress';

    onCreateForwarding(
      {
        name: draft.name.trim() || createDefaultForwardingName(draft, resolvedListenPort, targetPort),
        ownerName: draft.ownerName.trim() || t.owner,
        listenAddress: draft.listenAddress.trim() || '0.0.0.0',
        listenPort: resolvedListenPort,
        targetAddress: draft.targetAddress.trim(),
        targetPort,
        protocol: draft.protocol,
        entryNodeIds: draft.entryNodeIds,
        strategy: draft.strategy,
        quotaGb: Math.max(Number.parseInt(draft.quotaGb, 10) || 0, 0),
        monthlyResetDay: clampResetDay(Number.parseInt(draft.monthlyResetDay, 10) || 1),
        currentUsedTrafficGb: parseNonNegativeNumber(draft.currentUsedTrafficGb),
        rateLimitMbps: Math.max(Number.parseInt(draft.rateLimitMbps, 10) || 0, 0),
        rateLimitMode: draft.rateLimitMode,
        rateLimitDirection,
        ipRateLimitMbps: 0,
        maxConnections: 0,
        maxConnectionsPerIp: 0,
        proxyProtocol: false,
        billingDirection: draft.billingDirection,
        tunnelMode: draft.tunnelMode,
        enabled: draft.enabled
      },
      editingRule ? 'update' : 'create',
      editingRule?.id
    );
    setLastEntryEndpoints(
      Array.from(
        new Set(
          draft.entryNodeIds.map((agentId) => {
            const agent = agents.find((item) => item.id === agentId);
            return `${agent?.publicAddress ?? agentId}:${resolvedListenPort}`;
          })
        )
      )
    );
    setDrawer({ type: 'closed' });
  }

  function copyLastEntryEndpoints() {
    if (lastEntryEndpoints.length === 0) {
      return;
    }

    void navigator.clipboard?.writeText(lastEntryEndpoints.join('\n'));
  }

  function updateDraft(patch: Partial<ForwardDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function toggleRuleSelection(ruleId: string) {
    setBulkDeleteConfirming(false);
    setSelectedRuleIds((current) =>
      current.includes(ruleId) ? current.filter((id) => id !== ruleId) : [...current, ruleId]
    );
  }

  function toggleVisibleRuleSelection() {
    const visibleIds = filteredRules.map((rule) => rule.id);

    if (visibleIds.length === 0) {
      return;
    }

    setBulkDeleteConfirming(false);
    setSelectedRuleIds((current) => {
      const visibleIdSet = new Set(visibleIds);
      const allVisibleSelected = visibleIds.every((id) => current.includes(id));

      return allVisibleSelected
        ? current.filter((id) => !visibleIdSet.has(id))
        : Array.from(new Set([...current, ...visibleIds]));
    });
  }

  function runSelectedTasks(action: 'apply' | 'pause' | 'resume') {
    setBulkDeleteConfirming(false);
    if (selectedRules.length === 0) {
      return;
    }

    const actionLabel =
      action === 'apply' ? t.bulkApply : action === 'pause' ? t.bulkPause : t.bulkResume;
    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(t.confirmBulkRuntimeAction(actionLabel.replace(/^Bulk\s+/i, ''), String(selectedRules.length)));

    if (confirmed) {
      selectedRules.forEach((rule) => onRunTask(rule.id, action));
    }
  }

  function migrateSelectedRulesToEntryNode() {
    setBulkDeleteConfirming(false);
    if (selectedRules.length === 0 || !bulkMigrateEntryNodeId || hasBulkMigrationConflict) {
      return;
    }

    const targetAgent = agents.find((agent) => agent.id === bulkMigrateEntryNodeId);
    const targetLabel = targetAgent?.name ?? bulkMigrateEntryNodeId;
    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(t.confirmBulkMigrateEntry(String(selectedRules.length), targetLabel));

    if (!confirmed) {
      return;
    }

    selectedRules.forEach((rule) => {
      onCreateForwarding(
        createForwardingMetadataFromRule(rule, [bulkMigrateEntryNodeId]),
        'update',
        rule.id
      );
    });
  }

  function runRuleTask(rule: ForwardingRuleView, action: 'apply' | 'pause' | 'resume') {
    const actionLabel = action === 'apply' ? t.applyPolicy : action === 'pause' ? t.pausePolicy : t.resumePolicy;
    const confirmed =
      typeof window === 'undefined' || window.confirm(t.confirmRowRuntimeAction(actionLabel, rule.name));

    if (confirmed) {
      onRunTask(rule.id, action);
    }
  }

  function toggleEntryNode(agentId: string) {
    setDraft((current) => ({
      ...current,
      entryNodeIds: current.entryNodeIds.includes(agentId)
        ? current.entryNodeIds.filter((item) => item !== agentId)
        : [...current.entryNodeIds, agentId]
    }));
  }

  function deleteRule(rule: ForwardingRuleView) {
    const confirmed = typeof window === 'undefined' || window.confirm(t.confirmRowDelete(rule.name));

    if (!confirmed) {
      return;
    }

    onDeleteForwarding(rule);
    setRemovedRuleIds((current) => [...new Set([...current, rule.id])]);
    setSelectedRuleIds((current) => current.filter((id) => id !== rule.id));
    setBulkDeleteConfirming(false);
  }

  function deleteSelectedRules() {
    selectedRules.forEach((rule) => onDeleteForwarding(rule));
    setRemovedRuleIds((current) => [...new Set([...current, ...selectedRules.map((rule) => rule.id)])]);
    setSelectedRuleIds([]);
    setBulkDeleteConfirming(false);
  }

  return (
    <ResponsivePage>
      <ResponsiveSection className="stagger-1">
        <h3 className="text-base font-bold text-[#07111F] dark:text-white">{t.title}</h3>
      </ResponsiveSection>

      <WorkspaceCockpit
        aria-label={t.forwardingCockpit}
        className="forwarding-ops-cockpit stagger-2 xl:h-[calc(100dvh-10rem)] xl:overflow-hidden"
      >
        <div className="forwarding-cockpit-grid grid min-h-0 grid-cols-1 xl:h-full xl:grid-cols-[18rem_minmax(0,1fr)]">
        <aside
          className="forwarding-control-rail forwarding-ops-rail min-h-0 border-b border-[#07111F]/20 bg-[#FDFFF1] p-3 dark:border-white/10 dark:bg-white/[0.02] xl:overflow-y-auto xl:overscroll-contain xl:border-b-0 xl:border-r"
          aria-label={language === 'zh' ? '转发控制栏' : 'Forwarding control rail'}
          role="complementary"
        >
          <section
            className="stagger-2 forwarding-control-band forwarding-ops-overview-panel island-card p-3"
            aria-label={t.operationalOverview}
            role="region"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-2xl">
                <div className="flex items-center gap-2">
                  <Router className="h-4 w-4 text-[#1E3AFF] dark:text-primary" />
                  <p className="text-sm font-semibold text-[#07111F] dark:text-white">{t.operationalOverview}</p>
                </div>
              </div>
              <GlowButton className="gap-2 px-4 py-2 text-xs" onClick={openCreateDrawer}>
                <Plus className="h-3.5 w-3.5" />
                {t.createAction}
              </GlowButton>
            </div>

            <div className="forwarding-overview-metric-grid mt-3 grid grid-cols-2 gap-2">
              {overviewMetrics.map((metric) => (
                <OverviewMetric key={metric.label} {...metric} />
              ))}
            </div>
          </section>

          <ForwardingRuntimeReadinessPanel metrics={runtimeReadinessMetrics} t={t} />

          {lastEntryEndpoints.length > 0 ? (
            <section
              className="forwarding-entry-endpoint-status stagger-2 border border-[#00A878] bg-[#00A878]/10 p-3 text-sm text-[#07111F] dark:border-[#00D49A]/25 dark:bg-[#00A878]/10 dark:text-[#D7FFF3]"
              role="status"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <p className="text-xs font-black uppercase tracking-widest">{t.entryEndpointReady}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {lastEntryEndpoints.map((endpoint) => (
                      <code
                        className="border border-[#00A878] bg-[#FFFDF5] px-2.5 py-1 font-mono text-xs font-bold text-[#07111F] dark:border-[#00D49A]/25 dark:bg-white/[0.06] dark:text-[#D7FFF3]"
                        key={endpoint}
                      >
                        {endpoint}
                      </code>
                    ))}
                  </div>
                </div>
                <button
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-[#00A878] bg-[#FFFDF5] px-3 text-xs font-bold text-[#07111F] transition hover:-translate-y-0.5 hover:bg-[#00A878] hover:text-white dark:border-[#00D49A]/25 dark:bg-white/[0.06] dark:text-[#D7FFF3] dark:hover:bg-[#00A878]/20"
                  onClick={copyLastEntryEndpoints}
                  type="button"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t.copyEntryEndpoint}
                </button>
              </div>
            </section>
          ) : null}
        </aside>

        <WorkspaceCockpitScroller
          aria-label={t.forwardingRulesWorkspace}
          className="forwarding-ops-workspace min-h-0 xl:overflow-y-auto xl:overscroll-contain"
        >
          <div className="forwarding-workspace-shell min-h-0 p-3">
        <section
          className="stagger-3 forwarding-rule-panel forwarding-ops-rule-panel island-card overflow-visible"
          aria-label={language === 'zh' ? '规则管理面板' : 'Rule management panel'}
          role="complementary"
        >
          {visibleRules.length === 0 ? (
            <EmptyState label={t.noRules} />
          ) : (
            <>
            <div className="forwarding-rule-toolbar border-b border-[#07111F]/20 bg-[#EAF3D1]/55 p-3 dark:border-white/10 dark:bg-white/[0.02]">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(16rem,1fr)_minmax(12rem,0.3fr)]">
                <label className="block border border-[#07111F]/20 bg-[#FFFDF5] px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">{t.searchRules}</span>
                  <input
                    aria-label={t.searchRules}
                    className="mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-[#07111F] outline-none placeholder:text-[#35405A]/60 dark:text-white dark:placeholder:text-white/35"
                    onChange={(event) => setRuleSearch(event.target.value)}
                    placeholder={t.searchRulesPlaceholder}
                    type="search"
                    value={ruleSearch}
                  />
                </label>
                <label className="block border border-[#07111F]/20 bg-[#FFFDF5] px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">{t.ruleStatus}</span>
                  <select
                    aria-label={t.ruleStatus}
                    className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-[#07111F] outline-none dark:text-white"
                    onChange={(event) => setRuleStatusFilter(event.target.value as RuleStatusFilter)}
                    value={ruleStatusFilter}
                  >
                    <option value="">{t.allStatuses}</option>
                    <option value="enabled">{t.ruleStateLabels.enabled}</option>
                    <option value="disabled">{t.ruleStateLabels.disabled}</option>
                    {Object.keys(t.portStatusLabels).map((status) => (
                      <option key={status} value={status}>
                        {t.portStatusLabels[status as PortAllocationStatus]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">
                  {t.matchingRules} {filteredRules.length} / {visibleRules.length}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[#1E3AFF] bg-[#FFFDF5] px-3 py-1 text-xs font-bold text-[#1E3AFF] dark:border-[#6B7CFF]/30 dark:bg-primary/15 dark:text-primary">
                    {t.selectedRules} {selectedRules.length}
                  </span>
                  <button
                    className="rounded-full border border-[#07111F]/25 px-3 py-2 text-xs font-bold text-[#35405A] transition hover:border-[#1E3AFF] hover:bg-[#FFFDF5] hover:text-[#1E3AFF] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
                    disabled={filteredRules.length === 0}
                    onClick={toggleVisibleRuleSelection}
                    type="button"
                  >
                    {t.selectVisibleRules}
                  </button>
                  <label className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[#07111F]/25 bg-[#FFFDF5] px-2.5 text-xs font-bold text-[#35405A] dark:border-white/10 dark:bg-white/[0.03] dark:text-white/50">
                    <span className="whitespace-nowrap">{t.bulkMigrateEntryHost}</span>
                    <select
                      aria-label={t.bulkMigrateEntryHost}
                      className="ou-select min-h-7 min-w-28 bg-transparent text-xs font-black text-[#07111F] outline-none dark:text-white"
                      onChange={(event) => setBulkMigrateEntryNodeId(event.target.value)}
                      value={bulkMigrateEntryNodeId}
                    >
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-[#FF3D18] bg-[#FFFDF5] px-3 text-xs font-bold text-[#FF3D18] transition hover:-translate-y-0.5 hover:bg-[#FF3D18] hover:text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:bg-[#FFFDF5] disabled:hover:text-[#FF3D18] dark:border-[#FF6A3A]/45 dark:bg-white/[0.04] dark:text-[#FF6A3A] dark:hover:bg-[#FF6A3A] dark:hover:text-[#07111F]"
                    disabled={selectedRules.length === 0 || !bulkMigrateEntryNodeId || hasBulkMigrationConflict || taskMutationBusy}
                    onClick={migrateSelectedRulesToEntryNode}
                    type="button"
                  >
                    <Router className="h-3.5 w-3.5" />
                    {t.bulkMigrateEntry}
                  </button>
                  <button
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-[#07111F]/25 px-3 text-xs font-bold text-[#35405A] transition hover:bg-[#FFFDF5] hover:text-[#1E3AFF] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
                    disabled={selectedRules.length === 0 || taskMutationBusy}
                    onClick={() => runSelectedTasks('apply')}
                    type="button"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {t.bulkApply}
                  </button>
                  <button
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-[#07111F]/25 px-3 text-xs font-bold text-[#35405A] transition hover:bg-[#FFFDF5] hover:text-[#1E3AFF] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
                    disabled={selectedRules.length === 0 || taskMutationBusy}
                    onClick={() => runSelectedTasks('pause')}
                    type="button"
                  >
                    <Pause className="h-3.5 w-3.5" />
                    {t.bulkPause}
                  </button>
                  <button
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-[#07111F]/25 px-3 text-xs font-bold text-[#35405A] transition hover:bg-[#FFFDF5] hover:text-[#1E3AFF] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
                    disabled={selectedRules.length === 0 || taskMutationBusy}
                    onClick={() => runSelectedTasks('resume')}
                    type="button"
                  >
                    <Play className="h-3.5 w-3.5" />
                    {t.bulkResume}
                  </button>
                  <button
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-[#DC2626] px-3 text-xs font-bold text-[#DC2626] transition hover:bg-[#DC2626]/[0.10] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#F87171]/35 dark:text-[#FCA5A5] dark:hover:bg-[#DC2626]/15"
                    disabled={selectedRules.length === 0 || taskMutationBusy}
                    onClick={bulkDeleteConfirming ? deleteSelectedRules : () => setBulkDeleteConfirming(true)}
                    type="button"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {bulkDeleteConfirming ? t.confirmBulkDelete(String(selectedRules.length)) : t.bulkDelete}
                  </button>
                </div>
              </div>
              {selectedRules.length > 0 ? (
                <ForwardingBulkImpactPreflight
                  language={language}
                  selectedCount={selectedRules.length}
                  summary={forwardingBulkImpactSummary}
                  t={t}
                />
              ) : null}
              {hasBulkMigrationConflict ? (
                <div
                  className="mt-3 border border-[#DC2626] bg-[#DC2626]/[0.08] p-3 text-xs font-semibold leading-5 text-[#B91C1C] dark:border-[#F87171]/25 dark:bg-[#DC2626]/[0.12] dark:text-[#FCA5A5]"
                  role="alert"
                >
                  <p className="font-black">{t.portConflictTitle}</p>
                  <p className="mt-1">{t.portConflictHint}</p>
                  <ul className="mt-2 space-y-1">
                    {bulkMigrationConflicts.slice(0, 3).map((binding) => (
                      <li key={`${binding.agentName}:${binding.endpoint}:${binding.ruleName}`}>
                        {t.portConflictBinding(binding.agentName, binding.endpoint, binding.ruleName)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            {filteredRules.length === 0 ? (
              <EmptyState label={t.noMatchingRules} />
            ) : (
              <>
              <div className="forwarding-rule-table-region overflow-x-auto max-md:hidden">
                <table className="w-full min-w-[960px] text-left">
                  <thead className="bg-[#07111F] text-[10px] font-bold uppercase tracking-widest text-[#FDFFF1] dark:bg-white/[0.03] dark:text-white/40">
                    <tr>
                      <th className="px-3 py-2.5">
                        <input
                          aria-label={t.selectVisibleRules}
                          checked={filteredRules.length > 0 && selectedVisibleCount === filteredRules.length}
                          className="h-4 w-4 rounded border-[#FDFFF1]/60 text-[#1E3AFF] accent-[#1E3AFF]"
                          onChange={toggleVisibleRuleSelection}
                          type="checkbox"
                        />
                      </th>
                      <th className="px-3 py-2.5">{t.name}</th>
                      <th className="px-3 py-2.5">{t.binding}</th>
                      <th className="px-3 py-2.5">{t.target}</th>
                      <th className="px-3 py-2.5">{t.policy}</th>
                      <th className="px-3 py-2.5">{t.quota}</th>
                      <th className="px-3 py-2.5">{t.limiter}</th>
                      <th className="px-3 py-2.5 text-right">{t.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#07111F]/15 dark:divide-white/10">
                    {filteredRules.map((rule) => (
                      <tr
                        key={rule.id}
                        className="forwarding-ops-rule-row transition-colors hover:bg-[#EAF3D1]/45 dark:hover:bg-white/[0.03]"
                      >
                        <td className="px-3 py-2.5 align-top">
                          <input
                            aria-label={t.selectRule(rule.name)}
                            checked={selectedRuleIds.includes(rule.id)}
                            className="h-4 w-4 rounded border-[#07111F]/30 text-[#1E3AFF] accent-[#1E3AFF]"
                            onChange={() => toggleRuleSelection(rule.id)}
                            type="checkbox"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-start gap-3">
                            <span className="forwarding-rule-icon mt-1 border border-[#1E3AFF] bg-[#DCE1FF] p-2 text-[#1E3AFF] dark:border-[#6B7CFF]/30 dark:bg-primary/10 dark:text-primary">
                              <ArrowRightLeft className="h-4 w-4" />
                            </span>
                            <ForwardingRuleIdentity language={language} rule={rule} t={t} />
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="space-y-2">
                            {rule.bindings.map((binding) => (
                              <ForwardingRuntimePath
                                binding={binding}
                                key={`${rule.id}-${binding.agentId}-${binding.listenPort}-${binding.protocol}`}
                                ruleName={rule.name}
                                agentName={agents.find((agent) => agent.id === binding.agentId)?.name ?? binding.agentId}
                                statusLabel={t.portStatusLabels[binding.status]}
                                t={t}
                              />
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs font-semibold text-[#07111F] dark:text-white/70">
                          {rule.targetAddress}:{rule.targetPort}
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="text-xs font-bold text-[#07111F] dark:text-white/80">
                            {t.strategyOptions[rule.strategy]}
                          </p>
                          <p className="mt-1 text-[11px] text-[#35405A] dark:text-white/45">
                            {t.tunnelModeOptions[rule.tunnelMode]} / {t.billingOptions[rule.billingDirection]}
                          </p>
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="text-xs font-semibold text-[#07111F] dark:text-white/70">
                            {formatBytes(rule.usedBytes)} / {formatBytes(rule.quotaBytes)}
                          </p>
                          <p className="mt-1 text-[11px] text-[#35405A] dark:text-white/45">
                            {t.billingOptions[rule.billingDirection]} / {t.monthlyResetDay} {rule.monthlyResetDay}
                          </p>
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="text-xs font-bold text-[#07111F] dark:text-white/80">
                            {rule.rateLimitMbps} {t.unitMbps}
                          </p>
                          <p className="mt-1 text-[11px] font-semibold text-[#35405A] dark:text-white/60">
                            {t.rateLimitModeOptions[rule.rateLimitMode]} / {t.rateLimitDirectionOptions[rule.rateLimitDirection]}
                          </p>
                        </td>
                        <td className="px-3 py-2.5">
                          <ForwardingRuleActions
                            onDelete={() => deleteRule(rule)}
                            onEdit={() => openEditDrawer(rule)}
                            onRun={(action) => runRuleTask(rule, action)}
                            rule={rule}
                            t={t}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="forwarding-mobile-rule-list hidden gap-3 p-3 max-md:grid md:hidden">
                {filteredRules.map((rule) => (
                  <article
                    aria-label={`Mobile rule ${rule.name}`}
                    className="forwarding-mobile-rule-card min-w-0 border border-[#07111F]/20 bg-[#FFFDF5] p-3 shadow-[0_12px_30px_-26px_rgba(7,17,31,0.32)] dark:border-[#6B7CFF]/25 dark:bg-white/[0.035]"
                    key={rule.id}
                    role="group"
                  >
                    <div className="flex items-start gap-3">
                      <input
                        aria-label={t.selectRule(rule.name)}
                        checked={selectedRuleIds.includes(rule.id)}
                        className="mt-1 h-4 w-4 shrink-0 rounded border-[#07111F]/30 text-[#1E3AFF] accent-[#1E3AFF]"
                        onChange={() => toggleRuleSelection(rule.id)}
                        type="checkbox"
                      />
                      <ForwardingRuleIdentity language={language} rule={rule} t={t} />
                    </div>
                    <div className="mt-3 grid gap-2">
                      {rule.bindings.map((binding) => (
                        <ForwardingRuntimePath
                          binding={binding}
                          key={`${rule.id}-${binding.agentId}-${binding.listenPort}-${binding.protocol}-mobile`}
                          ruleName={rule.name}
                          agentName={agents.find((agent) => agent.id === binding.agentId)?.name ?? binding.agentId}
                          statusLabel={t.portStatusLabels[binding.status]}
                          t={t}
                        />
                      ))}
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2">
                      <ForwardingMobileFact label={t.target} value={`${rule.targetAddress}:${rule.targetPort}`} mono />
                      <ForwardingMobileFact
                        label={t.policy}
                        value={`${t.strategyOptions[rule.strategy]} / ${t.tunnelModeOptions[rule.tunnelMode]}`}
                      />
                      <ForwardingMobileFact
                        label={t.quota}
                        value={`${formatBytes(rule.usedBytes)} / ${formatBytes(rule.quotaBytes)}`}
                      />
                      <ForwardingMobileFact
                        label={t.limiter}
                        value={`${rule.rateLimitMbps} ${t.unitMbps} / ${t.rateLimitModeOptions[rule.rateLimitMode]}`}
                      />
                    </div>
                    <ForwardingRuleActions
                      className="mt-3 justify-start"
                      onDelete={() => deleteRule(rule)}
                      onEdit={() => openEditDrawer(rule)}
                      onRun={(action) => runRuleTask(rule, action)}
                      rule={rule}
                      t={t}
                    />
                  </article>
                ))}
              </div>
              </>
            )}
            </>
          )}
        </section>
          </div>
        </WorkspaceCockpitScroller>
        </div>
      </WorkspaceCockpit>

      <ConfigDrawer
        open={drawer.type !== 'closed'}
        returnFocusRef={returnFocusRef}
        title={editingRule ? t.editAction : t.createAction}
        onClose={() => setDrawer({ type: 'closed' })}
      >
        <form className="space-y-4" onSubmit={handleSubmit}>
          <FormSection title={t.binding}>
            <InputField label={t.owner} value={draft.ownerName} onChange={(value) => updateDraft({ ownerName: value })} />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <InputField label={t.listenPort} type="number" value={draft.listenPort} onChange={(value) => updateDraft({ listenPort: value })} />
              <InputField label={t.targetAddress} value={draft.targetAddress} onChange={(value) => updateDraft({ targetAddress: value })} />
              <InputField label={t.targetPort} type="number" value={draft.targetPort} onChange={(value) => updateDraft({ targetPort: value })} />
            </div>
            <SelectField
              label={t.protocol}
              value={draft.protocol}
              onChange={(value) => updateDraft({ protocol: value as ForwardProtocol })}
              options={[
                { label: 'TCP', value: 'tcp' },
                { label: 'UDP', value: 'udp' },
                { label: 'TCP + UDP', value: 'tcp+udp' }
              ]}
            />
            {hasPortConflict ? (
              <div
                className="border border-[#DC2626] bg-[#DC2626]/[0.08] p-3 text-xs font-semibold leading-5 text-[#B91C1C] dark:border-[#F87171]/25 dark:bg-[#DC2626]/[0.12] dark:text-[#FCA5A5]"
                role="alert"
              >
                <p className="font-black">{t.portConflictTitle}</p>
                <p className="mt-1">{t.portConflictHint}</p>
                <ul className="mt-2 space-y-1">
                  {conflictingBindings.slice(0, 3).map((binding) => (
                    <li key={`${binding.agentName}:${binding.endpoint}:${binding.ruleName}`}>
                      {t.portConflictBinding(binding.agentName, binding.endpoint, binding.ruleName)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="forwarding-entry-node-picker border border-[#07111F]/20 bg-[#FFFDF5] p-3 dark:border-white/10 dark:bg-black/20">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">{t.entryNodes}</p>
                <span className="rounded-full border border-[#1E3AFF] bg-[#DCE1FF] px-2.5 py-1 text-[10px] font-bold text-[#1E3AFF] dark:bg-primary/10 dark:text-primary">
                  {t.selected} {draft.entryNodeIds.length}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {agents.map((agent) => (
                  <label
                    key={agent.id}
                    className="flex cursor-pointer items-center justify-between gap-3 border border-[#07111F]/20 px-3 py-2 transition hover:bg-[#EAF3D1]/45 dark:border-white/10 dark:hover:bg-white/[0.04]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-bold text-[#07111F] dark:text-white/80">{agent.name}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-[#35405A] dark:text-white/40">
                        {agent.region} / {agent.publicAddress}
                      </span>
                    </span>
                    <GlassToggle
                      aria-label={`select ${agent.name}`}
                      checked={draft.entryNodeIds.includes(agent.id)}
                      onChange={() => toggleEntryNode(agent.id)}
                    />
                  </label>
                ))}
              </div>
            </div>
          </FormSection>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <InputField label={t.quotaGb} suffix={t.unitGb} type="number" value={draft.quotaGb} onChange={(value) => updateDraft({ quotaGb: value })} />
            <SelectField
              label={t.billingDirection}
              value={draft.billingDirection}
              onChange={(value) => updateDraft({ billingDirection: value as BillingDirection })}
              options={[
                { label: t.billingOptions.both, value: 'both' },
                { label: t.billingOptions.single, value: 'single' },
                { label: t.billingOptions.ingress, value: 'ingress' },
                { label: t.billingOptions.egress, value: 'egress' }
              ]}
            />
            <SelectField
              label={t.monthlyResetDay}
              value={draft.monthlyResetDay}
              onChange={(value) => updateDraft({ monthlyResetDay: value })}
              options={Array.from({ length: 31 }, (_, index) => ({
                label: String(index + 1),
                value: String(index + 1)
              }))}
            />
            <InputField label={t.rateLimitMbps} suffix={t.unitMbps} type="number" value={draft.rateLimitMbps} onChange={(value) => updateDraft({ rateLimitMbps: value })} />
            <SelectField
              label={t.rateLimitMode}
              value={draft.rateLimitMode}
              onChange={(value) =>
                updateDraft({
                  rateLimitMode: value as RateLimitMode,
                  rateLimitDirection:
                    value === 'bi-directional' ? 'both' : draft.rateLimitDirection === 'both' ? 'ingress' : draft.rateLimitDirection
                })
              }
              options={[
                { label: t.rateLimitModeOptions['bi-directional'], value: 'bi-directional' },
                { label: t.rateLimitModeOptions['one-way'], value: 'one-way' }
              ]}
            />
            <SelectField
              label={t.rateLimitDirection}
              value={draft.rateLimitDirection}
              onChange={(value) => updateDraft({ rateLimitDirection: value as RateLimitDirection })}
              options={rateLimitDirectionOptions}
            />
          </div>
          <label className="forwarding-enabled-toggle flex cursor-pointer items-center justify-between gap-3 border border-[#07111F]/20 bg-[#FFFDF5] p-3 dark:border-white/10 dark:bg-black/20">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">{t.enabled}</span>
            <GlassToggle aria-label={t.enabled} checked={draft.enabled} onChange={() => updateDraft({ enabled: !draft.enabled })} />
          </label>
          <details
            className="forwarding-advanced-options border border-[#07111F]/20 bg-[#FFFDF5] p-3 dark:border-white/10 dark:bg-black/10"
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
            open={advancedOpen}
          >
            <summary className="cursor-pointer text-xs font-black text-[#07111F] dark:text-white">{t.advancedOptions}</summary>
            {advancedOpen ? (
            <div className="forwarding-advanced-options-body mt-3 space-y-3">
              <InputField label={t.name} value={draft.name} onChange={(value) => updateDraft({ name: value })} />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <InputField label={t.listenAddress} value={draft.listenAddress} onChange={(value) => updateDraft({ listenAddress: value })} />
                <SelectField
                  label={t.strategy}
                  value={draft.strategy}
                  onChange={(value) => updateDraft({ strategy: value as ForwardStrategy })}
                  options={[
                    { label: t.strategyOptions.fifo, value: 'fifo' },
                    { label: t.strategyOptions['round-robin'], value: 'round-robin' },
                    { label: t.strategyOptions['least-latency'], value: 'least-latency' },
                    { label: t.strategyOptions.weighted, value: 'weighted' }
                  ]}
                />
                <SelectField
                  label={t.tunnelMode}
                  value={draft.tunnelMode}
                  onChange={(value) => updateDraft({ tunnelMode: value as TunnelMode })}
                  options={[
                    { label: t.tunnelModeOptions.direct, value: 'direct' }
                  ]}
                />
                <InputField
                  label={t.currentUsedTraffic}
                  step="0.1"
                  suffix={t.unitGb}
                  type="number"
                  value={draft.currentUsedTrafficGb}
                  onChange={(value) => updateDraft({ currentUsedTrafficGb: value })}
                />
              </div>
            </div>
            ) : null}
          </details>
          <div className="flex justify-end gap-3 pt-2">
            <GhostButton label={t.cancel} onClick={() => setDrawer({ type: 'closed' })} />
            <GlowButton className="px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60" disabled={taskMutationBusy || !canSubmitRule} type="submit">
              {t.save}
            </GlowButton>
          </div>
        </form>
      </ConfigDrawer>
    </ResponsivePage>
  );
}

function ForwardingBulkImpactPreflight({
  language,
  selectedCount,
  summary,
  t
}: {
  language: AppLanguage;
  selectedCount: number;
  summary: ForwardingBulkImpactSummary;
  t: (typeof copy)['zh' | 'en'];
}) {
  const riskPreview = summary.guardrailRisks.slice(0, 3);

  return (
    <section
      aria-label={t.forwardingBulkImpactPreflight}
      className="forwarding-bulk-impact-preflight mt-3 border border-[#1E3AFF] bg-[#D9FF00]/[0.18] p-3 shadow-[0_16px_36px_-32px_rgba(7,17,31,0.34)] dark:border-[#6B7CFF]/35 dark:bg-[#D9FF00]/[0.08]"
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-[#1E3AFF] dark:text-primary">
            {t.forwardingBulkImpactPreflight}
          </p>
          {t.forwardingBulkImpactHint ? (
            <p className="mt-1 max-w-3xl text-xs leading-5 text-[#35405A] dark:text-white/60">
              {t.forwardingBulkImpactHint}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {summary.entryHostLabels.slice(0, 4).map((label) => (
              <span
                className="rounded-full border border-[#1E3AFF] bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-bold text-[#07111F] dark:border-[#6B7CFF]/30 dark:bg-white/[0.04] dark:text-white/75"
                key={label}
              >
                {label}
              </span>
            ))}
            {summary.entryHostLabels.length > 4 ? (
              <span className="rounded-full border border-[#1E3AFF] bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-bold text-[#35405A] dark:border-[#6B7CFF]/30 dark:bg-white/[0.04] dark:text-white/55">
                +{formatNumber(summary.entryHostLabels.length - 4, language)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="forwarding-bulk-impact-metric-grid grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:w-[26rem]">
          <ForwardingBulkImpactMetric
            label={t.forwardingBulkImpactCustomers}
            value={formatNumber(summary.customerLabels.length, language)}
          />
          <ForwardingBulkImpactMetric
            label={t.forwardingBulkImpactEntryHosts}
            value={formatNumber(summary.entryHostLabels.length, language)}
          />
          <ForwardingBulkImpactMetric
            label={t.forwardingBulkImpactPortBindings}
            value={formatNumber(summary.bindingLabels.length, language)}
          />
          <ForwardingBulkImpactMetric label={t.forwardingBulkImpactUsedTraffic} value={formatBytes(summary.usedBytes)} />
          <ForwardingBulkImpactMetric label={t.selectedRules} value={formatNumber(selectedCount, language)} />
          <ForwardingBulkImpactMetric
            label={t.forwardingBulkImpactGuardrailRisks}
            value={formatNumber(summary.guardrailRisks.length, language)}
          />
          <ForwardingBulkImpactMetric
            label={t.forwardingBulkImpactPausedDisabled}
            value={formatNumber(summary.pausedOrDisabledCount, language)}
          />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-3">
        <ForwardingBulkImpactPreview
          title={t.forwardingBulkImpactCustomerPreview}
          values={summary.customerLabels.slice(0, 5)}
        />
        <ForwardingBulkImpactPreview
          title={t.forwardingBulkImpactBindingPreview}
          values={summary.bindingLabels.slice(0, 5)}
        />
        <ForwardingBulkImpactPreview
          title={t.forwardingBulkImpactRiskPreview}
          values={riskPreview.length > 0 ? riskPreview : [t.forwardingBulkImpactNoRisk]}
          warning={riskPreview.length > 0}
        />
      </div>
    </section>
  );
}

function ForwardingRuntimeReadinessPanel({
  metrics,
  t
}: {
  metrics: ForwardingRuntimeReadinessMetric[];
  t: (typeof copy)['zh' | 'en'];
}) {
  return (
    <section
      aria-label={t.runtimeReadiness}
      className="stagger-2 forwarding-readiness-panel mt-3 overflow-hidden border border-[#07111F] bg-[#FFFDF5] shadow-[0_18px_44px_-38px_rgba(7,17,31,0.42)] dark:border-[#6B7CFF]/30 dark:bg-white/[0.035]"
      role="region"
    >
      <div className="border-b border-[#07111F] bg-[#1E3AFF] px-3 py-2.5 text-white dark:border-[#6B7CFF]/30 dark:bg-[#1E3AFF]/80">
        <p className="text-xs font-black uppercase tracking-widest">{t.runtimeReadiness}</p>
        {t.runtimeReadinessHint ? <p className="mt-1 text-[11px] leading-4 text-white/82">{t.runtimeReadinessHint}</p> : null}
      </div>
      <div className="grid grid-cols-1 divide-y divide-[#07111F]/20 dark:divide-[#6B7CFF]/20">
        {metrics.map((metric) => (
          <ForwardingRuntimeReadinessMetricCard key={metric.state} metric={metric} />
        ))}
      </div>
    </section>
  );
}

function ForwardingRuntimeReadinessMetricCard({ metric }: { metric: ForwardingRuntimeReadinessMetric }) {
  const stateClass = {
    ready: 'bg-[#00A878]/[0.12] text-[#006B50] dark:bg-[#00A878]/[0.14] dark:text-[#7FF3C9]',
    issues: 'bg-[#FF3D18]/[0.13] text-[#C9220C] dark:bg-[#FF6A3A]/[0.12] dark:text-[#FFB197]',
    waiting: 'bg-[#D9FF00]/[0.26] text-[#425200] dark:bg-[#D9FF00]/[0.12] dark:text-[#EAFF5A]'
  } satisfies Record<ForwardingRuntimeReadinessState, string>;

  return (
    <article
      aria-label={metric.label}
      className="forwarding-readiness-metric group relative min-h-[52px] overflow-hidden px-3 py-2 transition-[background-color,transform] duration-200 ease-out hover:bg-[#EAF3D1]/70 motion-reduce:transition-none dark:hover:bg-white/[0.055]"
      role="group"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-[#07111F] dark:text-white">
            {metric.label}
          </p>
        </div>
        <span className={`min-w-12 border border-current px-2 py-0.5 text-center text-base font-black ${stateClass[metric.state]}`}>
          {metric.value}
        </span>
      </div>
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-1 origin-left scale-x-75 bg-[#1E3AFF] transition-transform duration-200 ease-out group-hover:scale-x-100 motion-reduce:transition-none"
      />
    </article>
  );
}

function ForwardingBulkImpactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border border-[#07111F]/25 bg-[#FFFDF5]/90 px-2.5 py-2 dark:border-[#6B7CFF]/25 dark:bg-white/[0.035]">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/45">{label}</p>
      <p className="mt-1 break-all text-sm font-black text-[#07111F] dark:text-white">{value}</p>
      <span className="sr-only">
        {label} {value}
      </span>
    </div>
  );
}

function ForwardingBulkImpactPreview({
  title,
  values,
  warning = false
}: {
  title: string;
  values: string[];
  warning?: boolean;
}) {
  return (
    <div className="min-w-0 border border-[#07111F]/25 bg-[#FFFDF5]/80 p-2.5 dark:border-[#6B7CFF]/25 dark:bg-white/[0.025]">
      <p className="text-[10px] font-black uppercase tracking-widest text-[#35405A] dark:text-white/45">{title}</p>
      <div className={warning ? 'mt-2 space-y-1 text-[#FF3D18] dark:text-[#EAFF5A]' : 'mt-2 space-y-1 text-[#07111F] dark:text-white/70'}>
        {values.map((value) => (
          <p className="truncate text-xs font-bold" key={value} title={value}>
            {value}
          </p>
        ))}
      </div>
    </div>
  );
}

function ForwardingRuntimeEvidenceCard({
  language,
  rule,
  t
}: {
  language: AppLanguage;
  rule: ForwardingRuleView;
  t: (typeof copy)['zh' | 'en'];
}) {
  const runtimeServices = Array.from(
    new Set(rule.bindings.flatMap((binding) => binding.runtimeServiceNames ?? []))
  );
  const nextAction = rule.enabled
    ? `${t.applyPolicy} / ${t.pausePolicy}`
    : t.resumePolicy;
  const guardrailText = rule.guardrailReason
    ? t.runtimeEvidenceGuardrail(rule.guardrailReason)
    : rule.quotaExceeded
      ? t.runtimeEvidenceGuardrail(t.quotaExceeded)
      : rule.runtimeDisabledByPolicy
        ? t.runtimeEvidenceGuardrail(t.quotaSuspended)
        : t.runtimeEvidenceNoGuardrail;
  const hasRisk = Boolean(rule.guardrailReason || rule.quotaExceeded || rule.runtimeDisabledByPolicy);

  return (
    <div
      aria-label={t.runtimeEvidenceForRule(rule.name)}
      className="forwarding-runtime-evidence-card mt-2 max-w-[17rem] border border-[#1E3AFF] bg-[#DCE1FF]/70 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:border-[#6B7CFF]/35 dark:bg-[#6B7CFF]/[0.08]"
      role="group"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-[#1E3AFF] dark:text-[#DDE3FF]">
          {t.runtimeEvidence}
        </span>
        <span className="rounded-full border border-[#1E3AFF] bg-[#FFFDF5] px-2 py-0.5 text-[10px] font-black text-[#1E3AFF] dark:border-[#6B7CFF]/30 dark:bg-white/[0.04] dark:text-[#DDE3FF]">
          {t.runtimeEvidenceBindings(formatNumber(rule.bindingCount, language))}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-black">
        <span className="rounded-full bg-[#FFFDF5] px-2 py-1 text-[#35405A] dark:bg-white/[0.05] dark:text-white/65">
          {t.runtimeEvidenceNextAction(nextAction)}
        </span>
        <span
          className={
            hasRisk
              ? 'rounded-full bg-[#FF3D18]/[0.14] px-2 py-1 text-[#C9220C] dark:bg-[#FF6A3A]/10 dark:text-[#FFB197]'
              : 'rounded-full bg-[#FFFDF5] px-2 py-1 text-[#35405A] dark:bg-white/[0.05] dark:text-white/65'
          }
        >
          {guardrailText}
        </span>
      </div>
      <div className="mt-1.5 space-y-1">
        {(runtimeServices.length > 0 ? runtimeServices : [t.runtimeEvidenceNoService]).slice(0, 3).map((service) => (
          <p
            className="break-all font-mono text-[10px] font-semibold leading-4 text-[#35405A] dark:text-white/55"
            key={service}
            title={service}
          >
            {service}
          </p>
        ))}
      </div>
      {runtimeServices.length > 3 ? (
        <p className="mt-1 text-[10px] font-bold text-[#35405A] dark:text-white/40">
          +{formatNumber(runtimeServices.length - 3, language)}
        </p>
      ) : null}
    </div>
  );
}

function ForwardingRuleIdentity({
  language,
  rule,
  t
}: {
  language: AppLanguage;
  rule: ForwardingRuleView;
  t: (typeof copy)['zh' | 'en'];
}) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-bold text-[#07111F] dark:text-white">{rule.name}</p>
      <p className="mt-1 text-[11px] text-[#35405A] dark:text-white/45">{rule.ownerName}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex rounded-full border border-[#07111F]/20 bg-[#FFFDF5] px-2.5 py-1 text-[10px] font-bold uppercase text-[#35405A] dark:bg-white/10 dark:text-white/50">
          {rule.enabled ? t.ruleStateLabels.enabled : t.ruleStateLabels.disabled}
        </span>
        <StatusPill label={t.portStatusLabels[rule.portStatus]} status={rule.portStatus} />
        {rule.runtimeDisabledByPolicy ? (
          <span className="inline-flex rounded-full border border-[#DC2626] bg-[#DC2626]/[0.10] px-2.5 py-1 text-[10px] font-black uppercase text-[#B91C1C] dark:border-[#F87171]/25 dark:bg-[#DC2626]/[0.14] dark:text-[#FCA5A5]">
            {t.quotaSuspended}
          </span>
        ) : rule.quotaExceeded ? (
          <span className="inline-flex rounded-full border border-[#FF3D18] bg-[#FFD8C6]/72 px-2.5 py-1 text-[10px] font-black uppercase text-[#B93C17] dark:border-[#FF6A3A]/30 dark:bg-[#FF6A3A]/12 dark:text-[#FFB197]">
            {t.quotaExceeded}
          </span>
        ) : null}
      </div>
      {rule.guardrailReason ? (
        <p
          className={`mt-1 break-all font-mono text-[10px] ${
            rule.runtimeDisabledByPolicy ? 'text-[#B91C1C] dark:text-[#FCA5A5]' : 'text-[#B93C17] dark:text-[#FFB197]'
          }`}
        >
          {rule.guardrailReason}
        </p>
      ) : null}
      <ForwardingRuntimeEvidenceCard language={language} rule={rule} t={t} />
    </div>
  );
}

function getPortStatusClass(status: PortAllocationStatus) {
  if (status === 'allocated') {
    return 'border border-[#00A878] bg-[#00A878]/10 text-[#006B50] dark:border-[#00D49A]/25 dark:bg-[#00A878]/15 dark:text-[#7FF3C9]';
  }

  if (status === 'paused') {
    return 'border border-[#07111F]/20 bg-[#FFFDF5] text-[#35405A] dark:border-white/10 dark:bg-white/10 dark:text-white/60';
  }

  if (status === 'conflict' || status === 'failed') {
    return 'border border-[#DC2626] bg-[#DC2626]/[0.10] text-[#B91C1C] dark:border-[#F87171]/25 dark:bg-[#DC2626]/[0.14] dark:text-[#FCA5A5]';
  }

  return 'border border-[#FF3D18]/35 bg-[#FF3D18]/10 text-[#C9220C] dark:border-[#FF6A3A]/25 dark:bg-[#FF6A3A]/10 dark:text-[#FFB197]';
}

function StatusPill({ label, status }: { label: string; status: PortAllocationStatus }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${getPortStatusClass(status)}`}>
      {label}
    </span>
  );
}

function IconButton({
  children,
  danger = false,
  label,
  onClick
}: {
  children: ReactNode;
  danger?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={
        danger
          ? 'rounded-full border border-[#DC2626] p-2 text-[#DC2626] transition hover:bg-[#DC2626]/[0.10] dark:border-[#F87171]/35 dark:text-[#FCA5A5] dark:hover:bg-[#DC2626]/15'
          : 'rounded-full border border-[#07111F]/25 p-2 text-[#35405A] transition hover:bg-[#DCE1FF] hover:text-[#1E3AFF] dark:border-white/10 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-primary'
      }
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function ForwardingMobileFact({ label, mono = false, value }: { label: string; mono?: boolean; value: string }) {
  return (
    <div className="min-w-0 border border-[#07111F]/18 bg-[#EAF3D1]/55 px-3 py-2 dark:border-[#6B7CFF]/20 dark:bg-white/[0.035]">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#35405A] dark:text-white/45">{label}</p>
      <p
        className={
          mono
            ? 'mt-1 break-all font-mono text-xs font-bold text-[#07111F] dark:text-white/75'
            : 'mt-1 text-xs font-bold text-[#07111F] dark:text-white/75'
        }
      >
        {value}
      </p>
    </div>
  );
}

function ForwardingRuleActions({
  className = 'justify-end',
  onDelete,
  onEdit,
  onRun,
  rule,
  t
}: {
  className?: string;
  onDelete: () => void;
  onEdit: () => void;
  onRun: (action: 'apply' | 'pause' | 'resume') => void;
  rule: ForwardingRuleView;
  t: (typeof copy)['zh' | 'en'];
}) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <IconButton label={t.editAction} onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" />
      </IconButton>
      {rule.enabled ? (
        <>
          <IconButton label={t.applyPolicy} onClick={() => onRun('apply')}>
            <Send className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label={t.pausePolicy} onClick={() => onRun('pause')}>
            <Pause className="h-3.5 w-3.5" />
          </IconButton>
        </>
      ) : (
        <IconButton label={t.resumePolicy} onClick={() => onRun('resume')}>
          <Play className="h-3.5 w-3.5" />
        </IconButton>
      )}
      <IconButton danger label={t.deleteRule} onClick={onDelete}>
        <Trash2 className="h-3.5 w-3.5" />
      </IconButton>
    </div>
  );
}

function InputField({
  label,
  onChange,
  step,
  suffix,
  type = 'text',
  value
}: {
  label: string;
  onChange: (value: string) => void;
  step?: string;
  suffix?: string;
  type?: 'number' | 'text';
  value: string;
}) {
  return (
    <label className="block border border-[#07111F]/20 bg-[#FFFDF5] p-3 dark:border-white/10 dark:bg-black/20">
      <span className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">{label}</span>
      <span className="mt-2 flex items-center gap-2">
        <input
          aria-label={label}
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#07111F] outline-none placeholder:text-[#35405A]/60 dark:text-white"
          min={type === 'number' ? 0 : undefined}
          onChange={(event) => onChange(event.target.value)}
          step={type === 'number' ? step : undefined}
          type={type}
          value={value}
        />
        {suffix ? <span className="text-[10px] font-bold text-[#35405A]/70 dark:text-white/35">{suffix}</span> : null}
      </span>
    </label>
  );
}

function SelectField({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label className="block border border-[#07111F]/20 bg-[#FFFDF5] p-3 dark:border-white/10 dark:bg-black/20">
      <span className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">{label}</span>
      <select
        aria-label={label}
        className="ou-select mt-2 w-full bg-transparent text-sm font-semibold text-[#07111F] outline-none dark:text-white"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FormSection({
  children,
  hint,
  title
}: {
  children: ReactNode;
  hint?: string;
  title: string;
}) {
  return (
    <section className="space-y-3 border-t border-[#07111F]/15 pt-4 first:border-t-0 first:pt-0 dark:border-white/10">
      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">{title}</h4>
        {hint ? <p className="mt-1 text-xs leading-6 text-[#35405A] dark:text-white/45">{hint}</p> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function GhostButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="rounded-full border border-[#07111F]/25 px-4 py-2 text-xs font-bold text-[#35405A] transition hover:bg-[#FFFDF5] hover:text-[#1E3AFF] dark:border-white/10 dark:text-white/60"
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="forwarding-empty-state p-3 text-center text-sm font-semibold text-[#35405A] dark:text-white/50">{label}</div>;
}

function ForwardingRuntimePath({
  agentName,
  binding,
  ruleName,
  statusLabel,
  t
}: {
  agentName: string;
  binding: ForwardPortBinding;
  ruleName: string;
  statusLabel: string;
  t: (typeof copy)['zh' | 'en'];
}) {
  const entryEndpoint = `${binding.listenAddress}:${binding.listenPort}`;
  const targetEndpoint = `${binding.targetAddress}:${binding.targetPort}`;
  const runtimeServiceNames = binding.runtimeServiceNames ?? [];

  return (
    <div
      aria-label={`${t.runtimePath} ${ruleName}`}
      className="forwarding-runtime-path-card border border-[#07111F]/25 bg-[#FFFDF5]/80 p-2.5 shadow-[0_10px_24px_-22px_rgba(7,17,31,0.22)] dark:border-[#6B7CFF]/25 dark:bg-white/[0.04] dark:shadow-none"
      role="group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#1E3AFF] dark:text-[#DDE3FF]">
            {t.runtimePath}
          </p>
          <p className="mt-1 truncate text-xs font-bold text-[#07111F] dark:text-white/80">{agentName}</p>
        </div>
        <StatusPill label={statusLabel} status={binding.status} />
      </div>

      <div className="mt-2 grid gap-2 text-[11px] md:grid-cols-[minmax(7rem,0.8fr)_minmax(9rem,1fr)]">
        <RuntimePathField label={t.runtimePathEntry} value={entryEndpoint} />
        <RuntimePathField label={t.runtimePathTarget} value={targetEndpoint} />
      </div>

      <div className="mt-2 min-w-0 border border-[#07111F]/20 bg-[#DCE1FF]/45 px-2.5 py-2 dark:border-[#6B7CFF]/25 dark:bg-black/20">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#35405A] dark:text-white/45">
          {t.runtimePathService}
        </p>
        <p className="mt-1 break-all font-mono text-[10px] font-semibold leading-4 text-[#35405A] dark:text-white/55">
          {runtimeServiceNames.length > 0 ? runtimeServiceNames.join(', ') : t.runtimePathNoService}
        </p>
      </div>
    </div>
  );
}

function RuntimePathField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border border-[#07111F]/20 bg-[#FFFDF5]/90 px-2.5 py-2 dark:border-[#6B7CFF]/25 dark:bg-black/20">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#35405A] dark:text-white/45">{label}</p>
      <p className="mt-1 truncate font-mono text-[11px] font-semibold text-[#07111F] dark:text-white/70">{value}</p>
    </div>
  );
}

function OverviewMetric({ ariaLabel, label, value, tone }: ForwardingOverviewMetric) {
  const metricClass =
    tone === 'signal'
      ? 'border border-[#FF3D18] bg-[#D9FF00]/[0.18] dark:border-[#FF6A3A]/30 dark:bg-[#D9FF00]/[0.08]'
      : '';
  const labelClass =
    tone === 'signal'
      ? 'text-[#C9220C] dark:text-[#FFB197]'
      : 'text-[#35405A] dark:text-white/45';
  return (
    <article aria-label={ariaLabel ?? label} role="group" className={`forwarding-overview-metric ou-surface-muted min-h-[56px] p-2.5 ${metricClass}`}>
      <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${labelClass}`}>{label}</p>
      <p className="mt-1 text-xl font-black text-[#07111F] dark:text-white">{value}</p>
    </article>
  );
}
