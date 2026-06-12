import { useEffect, useMemo, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import {
  ArrowRightLeft,
  CheckCircle2,
  CircleDollarSign,
  Copy,
  Gauge,
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
import { ResponsivePage, ResponsiveSection } from '../../components/layout/responsive-page';
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

const RANDOM_LISTEN_PORT_MIN = 20_000;
const RANDOM_LISTEN_PORT_MAX = 60_999;

const copy = {
  zh: {
    title: '端口转发',
    subtitle: '按端口转发模型管理转发规则、入口端口绑定和转发分组。规则可以应用到多个入口主机，并独立配置限速、限连、计费方向与转发策略。',
    rulesTab: '转发规则',
    createAction: '创建转发规则',
    editAction: '编辑转发规则',
    drawerDescription: '按入口主机、目标端点、协议、流量限制、计费方向和启用状态创建转发；高级项默认隐藏。',
    createHint: '普通创建只需要选择入口主机并填写目标端点，系统会自动生成规则名和运行时服务。',
    entryEndpointReady: '转发入口已生成',
    copyEntryEndpoint: '复制入口地址',
    advancedOptions: '高级配置',
    advancedHint: '仅在接管既有规则或需要覆盖监听地址、调度策略、历史用量时修改。',
    enabledRules: '启用规则',
    usedQuota: '已用配额',
    billingDirection: '计费方向',
    name: '规则名称',
    tunnel: '转发分组',
    owner: '客户',
    binding: '入口绑定',
    target: '目标端点',
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
    forwardingBulkImpactHint: '基于已选转发规则的客户、入口主机、端口绑定、配额和运行时守护状态预估批量操作影响。',
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
    currentUsedTrafficHint: '用于补录历史用量或修正首次接管前的转发统计，后续由 Agent 回传实时流量。',
    rateLimitMbps: '规则限速',
    rateLimitMode: '限速模式',
    rateLimitDirection: '限速方向',
    runtimeLimitsHint: '当前 Agent 运行时仅开放规则级单双向限速、流量配额和流量计费；单 IP 限速、连接数上限与 Proxy Protocol 暂不提交。',
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
    subtitle: 'Manage port forwarding rules, entry port bindings, and forwarding groups. A rule can target multiple entry hosts with independent rate, connection, billing, and strategy controls.',
    rulesTab: 'Forward Rules',
    createAction: 'Create Forward Rule',
    editAction: 'Edit Forward Rule',
    drawerDescription: 'Create forwarding from entry hosts, target endpoint, protocol, traffic limit, billing direction, and enabled state. Advanced settings stay hidden by default.',
    createHint: 'Ordinary creation only needs entry hosts and a target endpoint; rule name and runtime services are generated automatically.',
    entryEndpointReady: 'Entry endpoint ready',
    copyEntryEndpoint: 'Copy Entry Endpoint',
    advancedOptions: 'Advanced Config',
    advancedHint: 'Change these only when taking over an existing rule or overriding listen address, strategy, or historical usage.',
    enabledRules: 'Enabled Rules',
    usedQuota: 'Used Quota',
    billingDirection: 'Billing Direction',
    name: 'Rule Name',
    tunnel: 'Forward Group',
    owner: 'Customer',
    binding: 'Entry Binding',
    target: 'Target Endpoint',
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
    forwardingBulkImpactHint: 'Estimate bulk-action impact from selected customers, entry hosts, port bindings, quota, and runtime guardrails.',
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
    currentUsedTrafficHint: 'Backfill historical usage or correct the first takeover; Agent telemetry owns live counters after enrollment.',
    rateLimitMbps: 'Rule Rate',
    rateLimitMode: 'Rate Mode',
    rateLimitDirection: 'Rate Direction',
    runtimeLimitsHint: 'The current Agent runtime only accepts rule-level one-way or bi-directional rate limits, traffic quota, and billing counters; per-IP limits, connection caps, and Proxy Protocol are not submitted yet.',
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
  const totalUsed = visibleRules.reduce((sum, rule) => sum + rule.usedBytes, 0);
  const totalQuota = visibleRules.reduce((sum, rule) => sum + rule.quotaBytes, 0);
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
        <h3 className="text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
        <p className="mt-1 max-w-3xl text-xs leading-6 text-slate-500 dark:text-white/50">{t.subtitle}</p>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 text-[11px] font-black text-slate-600 [scrollbar-width:none] dark:text-white/65 max-md:-mx-1 max-md:px-1 max-md:[&::-webkit-scrollbar]:hidden">
          {(language === 'zh' ? ['选入口主机', '填目标端点', '设配额限速', '应用规则'] : ['Pick entry host', 'Set target', 'Quota & rate', 'Apply rule']).map((step, index) => (
            <span className="shrink-0 rounded-full border border-slate-200 bg-white/70 px-3 py-1.5 dark:border-white/10 dark:bg-white/[0.04]" key={step}>
              {index + 1}. {step}
            </span>
          ))}
        </div>
      </ResponsiveSection>

      <section className="stagger-2 island-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-xl bg-blue-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-blue-500/20 dark:bg-primary dark:text-slate-950">
              {t.rulesTab}
            </span>
          </div>
          <GlowButton
            className="gap-2 px-4 py-2 text-xs"
            onClick={openCreateDrawer}
          >
            <Plus className="h-3.5 w-3.5" />
            {t.createAction}
          </GlowButton>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <SummaryMetric icon={Router} label={t.enabledRules} value={`${enabledCount}/${visibleRules.length}`} />
          <SummaryMetric icon={Gauge} label={t.usedQuota} value={`${formatBytes(totalUsed)} / ${formatBytes(totalQuota)}`} />
          <SummaryMetric icon={CircleDollarSign} label={t.billingDirection} value={formatBillingDirectionSummary(visibleRules, t)} />
        </div>
      </section>

      {lastEntryEndpoints.length > 0 ? (
        <section
          className="stagger-2 rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 text-sm text-emerald-800 shadow-sm dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-100"
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
                    className="rounded-lg border border-emerald-200 bg-white px-2.5 py-1 font-mono text-xs font-bold text-emerald-800 dark:border-emerald-300/20 dark:bg-white/[0.06] dark:text-emerald-100"
                    key={endpoint}
                  >
                    {endpoint}
                  </code>
                ))}
              </div>
            </div>
            <button
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-white px-3 text-xs font-bold text-emerald-700 transition hover:-translate-y-0.5 hover:border-emerald-400 hover:bg-emerald-50 dark:border-emerald-300/25 dark:bg-white/[0.06] dark:text-emerald-100 dark:hover:bg-emerald-300/10"
              onClick={copyLastEntryEndpoints}
              type="button"
            >
              <Copy className="h-3.5 w-3.5" />
              {t.copyEntryEndpoint}
            </button>
          </div>
        </section>
      ) : null}

      <section className="stagger-3 island-card overflow-hidden">
        {visibleRules.length === 0 ? (
          <EmptyState label={t.noRules} />
        ) : (
          <>
            <div className="border-b border-slate-200 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/[0.02]">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(16rem,1fr)_minmax(12rem,0.3fr)]">
                <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{t.searchRules}</span>
                  <input
                    aria-label={t.searchRules}
                    className="mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-white/35"
                    onChange={(event) => setRuleSearch(event.target.value)}
                    placeholder={t.searchRulesPlaceholder}
                    type="search"
                    value={ruleSearch}
                  />
                </label>
                <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{t.ruleStatus}</span>
                  <select
                    aria-label={t.ruleStatus}
                    className="glass-select-control mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
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
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                  {t.matchingRules} {filteredRules.length} / {visibleRules.length}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-600 dark:bg-primary/15 dark:text-primary">
                    {t.selectedRules} {selectedRules.length}
                  </span>
                  <button
                    className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-white hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
                    disabled={filteredRules.length === 0}
                    onClick={toggleVisibleRuleSelection}
                    type="button"
                  >
                    {t.selectVisibleRules}
                  </button>
                  <label className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/50">
                    <span className="whitespace-nowrap">{t.bulkMigrateEntryHost}</span>
                    <select
                      aria-label={t.bulkMigrateEntryHost}
                      className="glass-select-control min-h-7 min-w-28 bg-transparent text-xs font-black text-slate-800 outline-none dark:text-white"
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
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-cyan-200 px-3 text-xs font-bold text-cyan-700 transition hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-cyan-400/30 dark:text-cyan-200 dark:hover:bg-cyan-400/10"
                    disabled={selectedRules.length === 0 || !bulkMigrateEntryNodeId || hasBulkMigrationConflict || taskMutationBusy}
                    onClick={migrateSelectedRulesToEntryNode}
                    type="button"
                  >
                    <Router className="h-3.5 w-3.5" />
                    {t.bulkMigrateEntry}
                  </button>
                  <button
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:bg-white hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
                    disabled={selectedRules.length === 0 || taskMutationBusy}
                    onClick={() => runSelectedTasks('apply')}
                    type="button"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {t.bulkApply}
                  </button>
                  <button
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:bg-white hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
                    disabled={selectedRules.length === 0 || taskMutationBusy}
                    onClick={() => runSelectedTasks('pause')}
                    type="button"
                  >
                    <Pause className="h-3.5 w-3.5" />
                    {t.bulkPause}
                  </button>
                  <button
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 transition hover:bg-white hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
                    disabled={selectedRules.length === 0 || taskMutationBusy}
                    onClick={() => runSelectedTasks('resume')}
                    type="button"
                  >
                    <Play className="h-3.5 w-3.5" />
                    {t.bulkResume}
                  </button>
                  <button
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-400/30 dark:text-rose-200 dark:hover:bg-rose-400/10"
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
                  className="mt-3 rounded-lg border border-red-200 bg-red-50/80 p-3 text-xs font-semibold leading-5 text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200"
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
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1140px] text-left">
                  <thead className="bg-slate-50/70 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-white/[0.03] dark:text-white/40">
                    <tr>
                      <th className="px-5 py-3">
                        <input
                          aria-label={t.selectVisibleRules}
                          checked={filteredRules.length > 0 && selectedVisibleCount === filteredRules.length}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600"
                          onChange={toggleVisibleRuleSelection}
                          type="checkbox"
                        />
                      </th>
                      <th className="px-5 py-3">{t.name}</th>
                      <th className="px-5 py-3">{t.binding}</th>
                      <th className="px-5 py-3">{t.target}</th>
                      <th className="px-5 py-3">{t.policy}</th>
                      <th className="px-5 py-3">{t.quota}</th>
                      <th className="px-5 py-3">{t.limiter}</th>
                      <th className="px-5 py-3 text-right">{t.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                    {filteredRules.map((rule) => (
                      <tr key={rule.id} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.03]">
                        <td className="px-5 py-4 align-top">
                          <input
                            aria-label={t.selectRule(rule.name)}
                            checked={selectedRuleIds.includes(rule.id)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600"
                            onChange={() => toggleRuleSelection(rule.id)}
                            type="checkbox"
                          />
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-start gap-3">
                            <span className="mt-1 rounded-lg bg-blue-500/10 p-2 text-blue-600 dark:bg-primary/10 dark:text-primary">
                              <ArrowRightLeft className="h-4 w-4" />
                            </span>
                            <div>
                              <p className="text-sm font-bold text-slate-900 dark:text-white">{rule.name}</p>
                              <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">{rule.ownerName}</p>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-500 dark:bg-white/10 dark:text-white/50">
                                  {rule.enabled ? t.ruleStateLabels.enabled : t.ruleStateLabels.disabled}
                                </span>
                                <StatusPill label={t.portStatusLabels[rule.portStatus]} status={rule.portStatus} />
                                {rule.runtimeDisabledByPolicy ? (
                                  <span className="inline-flex rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-black uppercase text-rose-600 dark:bg-rose-500/15 dark:text-rose-200">
                                    {t.quotaSuspended}
                                  </span>
                                ) : rule.quotaExceeded ? (
                                  <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-black uppercase text-amber-600 dark:bg-amber-500/15 dark:text-amber-200">
                                    {t.quotaExceeded}
                                  </span>
                                ) : null}
                              </div>
                              {rule.guardrailReason ? (
                                <p className="mt-1 font-mono text-[10px] text-rose-500 dark:text-rose-300">
                                  {rule.guardrailReason}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="space-y-2">
                            {rule.bindings.map((binding) => {
                              const boundAgent = agents.find((agent) => agent.id === binding.agentId);

                              return (
                                <div
                                  className="rounded-lg border border-slate-200 bg-white/50 p-2 dark:border-white/10 dark:bg-black/10"
                                  key={`${rule.id}-${binding.agentId}-${binding.listenPort}-${binding.protocol}`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="truncate text-xs font-bold text-slate-800 dark:text-white/80">
                                        {boundAgent?.name ?? binding.agentId}
                                      </p>
                                      <p className="mt-1 font-mono text-[11px] font-semibold text-slate-600 dark:text-white/60">
                                        {binding.listenAddress}:{binding.listenPort} -&gt; {binding.targetAddress}:{binding.targetPort}
                                      </p>
                                    </div>
                                    <StatusPill label={t.portStatusLabels[binding.status]} status={binding.status} />
                                  </div>
                                  {binding.runtimeServiceNames?.length ? (
                                    <p className="mt-1 truncate font-mono text-[10px] text-slate-400 dark:text-white/35">
                                      {binding.runtimeServiceNames.join(', ')}
                                    </p>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                        <td className="px-5 py-4 font-mono text-xs font-semibold text-slate-700 dark:text-white/70">
                          {rule.targetAddress}:{rule.targetPort}
                        </td>
                        <td className="px-5 py-4">
                          <p className="text-xs font-bold text-slate-800 dark:text-white/80">
                            {t.strategyOptions[rule.strategy]}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                            {t.tunnelModeOptions[rule.tunnelMode]} / {t.billingOptions[rule.billingDirection]}
                          </p>
                        </td>
                        <td className="px-5 py-4">
                          <p className="text-xs font-semibold text-slate-700 dark:text-white/70">
                            {formatBytes(rule.usedBytes)} / {formatBytes(rule.quotaBytes)}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">
                            {t.billingOptions[rule.billingDirection]} / {t.monthlyResetDay} {rule.monthlyResetDay}
                          </p>
                        </td>
                        <td className="px-5 py-4">
                          <p className="text-xs font-bold text-slate-800 dark:text-white/80">
                            {rule.rateLimitMbps} {t.unitMbps}
                          </p>
                          <p className="mt-1 text-[11px] font-semibold text-slate-600 dark:text-white/60">
                            {t.rateLimitModeOptions[rule.rateLimitMode]} / {t.rateLimitDirectionOptions[rule.rateLimitDirection]}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500 dark:text-white/45">{t.runtimeLimitsHint}</p>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            <IconButton label={t.editAction} onClick={() => openEditDrawer(rule)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </IconButton>
                            {rule.enabled ? (
                              <>
                                <IconButton label={t.applyPolicy} onClick={() => runRuleTask(rule, 'apply')}>
                                  <Send className="h-3.5 w-3.5" />
                                </IconButton>
                                <IconButton label={t.pausePolicy} onClick={() => runRuleTask(rule, 'pause')}>
                                  <Pause className="h-3.5 w-3.5" />
                                </IconButton>
                              </>
                            ) : (
                              <IconButton label={t.resumePolicy} onClick={() => runRuleTask(rule, 'resume')}>
                                <Play className="h-3.5 w-3.5" />
                              </IconButton>
                            )}
                            <IconButton danger label={t.deleteRule} onClick={() => deleteRule(rule)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </IconButton>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <ConfigDrawer
        description={t.drawerDescription}
        open={drawer.type !== 'closed'}
        returnFocusRef={returnFocusRef}
        title={editingRule ? t.editAction : t.createAction}
        onClose={() => setDrawer({ type: 'closed' })}
      >
        <form className="space-y-4" onSubmit={handleSubmit}>
          <FormSection hint={t.createHint} title={t.binding}>
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
                className="rounded-lg border border-red-200 bg-red-50/80 p-3 text-xs font-semibold leading-5 text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200"
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
            <div className="rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{t.entryNodes}</p>
                <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-[10px] font-bold text-blue-600 dark:bg-primary/10 dark:text-primary">
                  {t.selected} {draft.entryNodeIds.length}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {agents.map((agent) => (
                  <label
                    key={agent.id}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-white/10"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-bold text-slate-800 dark:text-white/80">{agent.name}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-slate-500 dark:text-white/40">
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
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{t.enabled}</span>
            <GlassToggle aria-label={t.enabled} checked={draft.enabled} onChange={() => updateDraft({ enabled: !draft.enabled })} />
          </label>
          <p className="rounded-lg border border-slate-200 bg-white/60 p-3 text-[10px] font-semibold leading-5 text-slate-500 dark:border-white/10 dark:bg-black/20 dark:text-white/45">{t.runtimeLimitsHint}</p>
          <details
            className="rounded-lg border border-slate-200 bg-white/50 p-4 dark:border-white/10 dark:bg-black/10"
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
            open={advancedOpen}
          >
            <summary className="cursor-pointer text-xs font-black text-slate-800 dark:text-white">{t.advancedOptions}</summary>
            {advancedOpen ? (
            <div className="mt-4 space-y-3">
              <p className="text-xs leading-6 text-slate-500 dark:text-white/45">{t.advancedHint}</p>
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
              <p className="text-[10px] leading-5 text-slate-500 dark:text-white/40">{t.currentUsedTrafficHint}</p>
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

function SummaryMetric({
  label,
  value,
  icon: Icon
}: {
  label: string;
  value: string;
  icon: typeof Router;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/50 p-4 dark:border-white/10 dark:bg-black/10">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
          <p className="mt-2 text-xl font-black text-slate-900 dark:text-white">{value}</p>
        </div>
        <Icon className="h-5 w-5 text-blue-500 dark:text-primary" />
      </div>
    </div>
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
      className="mt-3 rounded-xl border border-cyan-200 bg-cyan-50/60 p-4 dark:border-cyan-300/15 dark:bg-cyan-400/[0.045]"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-cyan-700 dark:text-cyan-200">
            {t.forwardingBulkImpactPreflight}
          </p>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600 dark:text-white/55">
            {t.forwardingBulkImpactHint}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.entryHostLabels.slice(0, 4).map((label) => (
              <span
                className="rounded-full border border-cyan-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 dark:border-cyan-300/20 dark:bg-white/[0.04] dark:text-white/70"
                key={label}
              >
                {label}
              </span>
            ))}
            {summary.entryHostLabels.length > 4 ? (
              <span className="rounded-full border border-cyan-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500 dark:border-cyan-300/20 dark:bg-white/[0.04] dark:text-white/50">
                +{formatNumber(summary.entryHostLabels.length - 4, language)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:w-[34rem]">
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
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
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

function ForwardingBulkImpactMetric({ label, value }: { label: string; value: string }) {
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

function getPortStatusClass(status: PortAllocationStatus) {
  if (status === 'allocated') {
    return 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-200';
  }

  if (status === 'paused') {
    return 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/60';
  }

  if (status === 'conflict' || status === 'failed') {
    return 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-200';
  }

  return 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-200';
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
          ? 'rounded-full border border-rose-200 p-2 text-rose-500 transition hover:bg-rose-50 dark:border-rose-400/30 dark:hover:bg-rose-400/10'
          : 'rounded-full border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-blue-600 dark:border-white/10 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-primary'
      }
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
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
    <label className="block rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</span>
      <span className="mt-2 flex items-center gap-2">
        <input
          aria-label={label}
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-white"
          min={type === 'number' ? 0 : undefined}
          onChange={(event) => onChange(event.target.value)}
          step={type === 'number' ? step : undefined}
          type={type}
          value={value}
        />
        {suffix ? <span className="text-[10px] font-bold text-slate-400 dark:text-white/35">{suffix}</span> : null}
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
    <label className="block rounded-lg border border-slate-200 bg-white/60 p-3 dark:border-white/10 dark:bg-black/20">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</span>
      <select
        aria-label={label}
        className="glass-select-control mt-2 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
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
    <section className="space-y-3 border-t border-slate-200 pt-4 first:border-t-0 first:pt-0 dark:border-white/10">
      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{title}</h4>
        {hint ? <p className="mt-1 text-xs leading-6 text-slate-500 dark:text-white/45">{hint}</p> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function GhostButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 dark:border-white/10 dark:text-white/60"
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="p-8 text-center text-sm font-semibold text-slate-500 dark:text-white/50">{label}</div>;
}
