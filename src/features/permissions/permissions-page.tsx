import { Fragment, useMemo, useState } from 'react';
import { Ban, Copy, KeyRound, LockKeyhole, RefreshCw, RotateCcw, Search, ShieldCheck, UsersRound } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { ResponsivePage, WorkspaceCockpit, WorkspaceCockpitScroller } from '../../components/layout/responsive-page';
import { GlassCard } from '../../components/ui/glass-card';
import { GlassToggle } from '../../components/ui/glass-toggle';
import { GlowButton } from '../../components/ui/glow-button';
import type {
  AgentCredentialSummary,
  AgentSessionSummary,
  OperatorSessionStatus,
  OperatorSessionSummary,
  PermissionGrant,
  QuotaPolicy,
  ResourcePermission
} from '../../domain';
import type { ForwardingRuleView } from '../forwarding/forwarding-page';
import { formatBytes, formatDateTime, formatNumber, formatPercent } from '../shared/format';
import { calculateQuotaPolicyUsageRatio } from '../../services/api/quota-policies';

type PermissionsPageProps = {
  agentCredentials?: AgentCredentialSummary[];
  agentSessions?: AgentSessionSummary[];
  currentOperatorSessionId?: string;
  grants: PermissionGrant[];
  language: AppLanguage;
  operatorSessions?: OperatorSessionSummary[];
  operatorSessionsError?: string;
  operatorSessionsLoading?: boolean;
  quotaPolicies: QuotaPolicy[];
  forwardingRules: ForwardingRuleView[];
  taskMutationBusy?: boolean;
  onRevokeAgentCredential?: (credentialId: string) => void;
  onRevokeOperatorSession?: (sessionId: string) => void;
  onRotateAgentCredential?: (credentialId: string) => void;
  onRunTask: (id: string) => void;
  onResetQuota: (policy: QuotaPolicy) => void;
};

const permissionOrder: ResourcePermission[] = ['read', 'operate', 'configure', 'grant'];
type GrantResourceTypeFilter = 'all' | PermissionGrant['resourceType'];
type GrantPermissionFilter = 'all' | ResourcePermission;
type OperatorSessionStatusFilter = 'all' | OperatorSessionStatus;
const grantResourceTypes: PermissionGrant['resourceType'][] = ['agent', 'node', 'tunnel', 'tunnel-group', 'subscription', 'forward-rule'];
const operatorSessionStatuses: OperatorSessionStatus[] = ['active', 'revoked', 'expired'];

const copy = {
  zh: {
    title: '分组授权',
    subtitle: '面向操作员、用户组、转发分组和端口转发资源的最小权限、配额约束与审计入口。',
    operationalOverview: '运营总览',
    operationalOverviewHint: '先核对授权面、配额护栏、会话健康和凭证轮换，再下发任何权限变更。',
    operationalSteps: ['审阅授权', '核对配额', '审计会话', '轮换凭证'],
    subjects: '授权主体',
    delegatedRoles: '授权角色',
    quotaPolicies: '配额策略',
    scopedForwarding: '受控转发',
    agentCredentials: 'Agent 凭证',
    matrixTitle: '授权清单',
    leastPrivilege: '最小权限',
    searchGrants: '搜索授权',
    searchGrantsPlaceholder: '主体、资源、grant-id、原因或授权人',
    resourceType: '资源类型',
    allResourceTypes: '全部资源',
    requiredPermission: '权限位',
    allPermissions: '全部权限',
    matchingGrants: '当前匹配',
    noMatchingGrants: '没有匹配的授权记录',
    rowHint: '操作员组变更会写入执行记录，再由后端持久化授权并记录审计证据。',
    submitChange: '提交权限变更',
    confirmSubmitChange: (grantId: string) => `确认提交权限变更 ${grantId}？`,
    quotaTitle: '配额护栏',
    quotaUsage: '聚合配额使用',
    usage: '使用率',
    billingPolicy: '计费方向跟随端口转发账号策略。',
    quotaReadModelTitle: '真实配额读模型',
    quotaReadModelHint: '聚合受控主机、客户节点、端口转发账号、转发链路和端口转发规则的真实配额状态，直接反映当前计费窗口内的使用量与停用原因。',
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
      tunnel: '转发链路',
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
    confirmResetQuota: (name: string) => `确认重置 ${name} 的配额？`,
    quotaResetImpactPreflight: '配额重置影响预检',
    quotaResetImpactHint: '重置会清零当前计费窗口内的配额读模型计数，并写入执行记录；执行前核对对象、计费方向、窗口和停用原因。',
    quotaResetImpactTarget: '目标',
    quotaResetImpactCurrentUsage: '当前用量',
    quotaResetImpactUsageRatio: '使用率',
    quotaResetImpactBillingDirection: '计费方向',
    quotaResetImpactResetWindow: '重置窗口',
    quotaResetImpactCurrentState: '当前状态',
    quotaResetImpactGuardrail: '护栏',
    quotaResetImpactPreview: '影响预览',
    quotaResetImpactCounterScope: '计数范围',
    quotaResetImpactReadModelState: '读模型状态',
    quotaResetImpactRuntimeGuard: '运行时护栏',
    quotaResetImpactRuntimeUnchanged: '运行时状态不自动改变',
    quotaResetImpactRuntimeMayResume: '重置后可由后端恢复运行时停用状态',
    quotaResetImpactNoGuardrail: '无停用原因',
    scopeTitle: '资源范围',
    sessionsTitle: '操作员会话',
    sessionsSubtitle: '服务端登记的控制面会话，可按会话撤销并保留审计证据。',
    sessionsLoading: '正在读取会话列表',
    sessionsEmpty: '当前没有可管理的操作员会话。',
    searchSessions: '搜索操作员会话',
    searchSessionsPlaceholder: '搜索用户名、会话、来源、客户端、请求或分组',
    sessionStatusFilter: '会话状态',
    allSessionStatuses: '全部状态',
    matchingSessions: '当前匹配',
    noMatchingSessions: '没有匹配的操作员会话。',
    selectSession: '选择会话',
    selectVisibleSessions: '选择当前会话',
    selectedSessions: '已选会话',
    copySelectedSessionEvidence: '复制已选会话证据',
    bulkRevokeSessions: '批量撤销会话',
    confirmBulkRevokeSessions: (count: string) => `确认撤销 ${count} 个已选操作员会话？`,
    sessionBulkImpactPreflight: '会话批量影响预检',
    sessionBulkImpactHint: '基于已选操作员会话的账号、来源、客户端、到期和请求证据预估撤销影响；执行前核对不要撤销错误来源。',
    sessionBulkImpactOperators: '受影响操作员',
    sessionBulkImpactSources: '来源地址',
    sessionBulkImpactClients: '客户端指纹',
    sessionBulkImpactRequests: '请求证据',
    sessionBulkImpactExpiring: '已过期/即将到期',
    sessionBulkImpactOperatorPreview: '操作员预览',
    sessionBulkImpactSourcePreview: '来源预览',
    sessionBulkImpactRequestPreview: '请求预览',
    currentSession: '当前会话',
    revokeSession: '撤销会话',
    revokeCurrentSession: '撤销并退出',
    confirmRevokeSession: (sessionId: string) => `确认撤销操作员会话 ${sessionId}？`,
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
    agentCredentialsTitle: 'Agent 运行凭证',
    agentCredentialsSubtitle:
      '集中查看安装凭证和运行凭证的脱敏摘要；面板只展示 tokenPrefix，不展示原始 token 或 tokenHash，撤销与轮换都会写入审计链。',
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
    credentialRevokedMeta: (reason: string, actor: string) => `撤销原因：${reason} · 执行者：${actor}`,
    revokeCredential: '撤销凭证',
    rotateCredential: '轮换凭证',
    confirmCredentialOperation: (action: string, credentialId: string) => `确认${action} ${credentialId}？`,
    credentialOperationPreflight: 'Agent 凭证操作预检',
    credentialOperationHint: '轮换或撤销运行凭证会影响 Agent 会话、命令通道和安装组件；执行前核对绑定会话、能力和审计请求。',
    credentialImpactAgent: '绑定 Agent',
    credentialImpactSession: '绑定会话',
    credentialImpactCapabilities: '能力',
    credentialImpactTokenPrefix: '令牌前缀',
    credentialImpactRequest: '请求证据',
    credentialImpactCapabilityPreview: '能力预览',
    credentialImpactLifecyclePreview: '生命周期预览',
    credentialImpactAuditPreview: '审计预览',
    credentialImpactNoCapabilities: '暂无能力',
    granted: '已授权',
    denied: '已拒绝',
    permissionsSafetyCockpit: '权限安全 cockpit',
    permissionsControlRail: '权限控制轨',
    permissionsEvidenceWorkspace: '权限证据工作区',
    operator: 'operator',
    group: 'group',
    resourceTypeLabels: {
      agent: '主机代理',
      node: '节点',
      tunnel: '端口转发',
      'tunnel-group': '转发分组',
      subscription: '订阅',
      'forward-rule': '转发规则'
    }
  },
  en: {
    title: 'Group Authorization',
    subtitle:
      'Least-privilege access, quota guardrails, and audited permission changes for operators, groups, forwarding groups, and port-forwarding resources.',
    operationalOverview: 'Operational Overview',
    operationalOverviewHint:
      'Review the grant surface, quota guardrails, session health, and credential rotation before changing policy.',
    operationalSteps: ['Review grants', 'Check quotas', 'Audit sessions', 'Rotate credentials'],
    subjects: 'Subjects',
    delegatedRoles: 'Delegated Roles',
    quotaPolicies: 'Quota Policies',
    scopedForwarding: 'Scoped Forwarding',
    agentCredentials: 'Agent Credentials',
    matrixTitle: 'Access Grants',
    leastPrivilege: 'Least Privilege',
    searchGrants: 'Search Grants',
    searchGrantsPlaceholder: 'Subject, resource, grant-id, reason, or actor',
    resourceType: 'Resource Type',
    allResourceTypes: 'All Resources',
    requiredPermission: 'Required Permission',
    allPermissions: 'All Permissions',
    matchingGrants: 'Matching',
    noMatchingGrants: 'No matching access grants',
    rowHint:
      'Operator group changes are written to the execution log before the backend persists grants and records audit evidence.',
    submitChange: 'Submit Permission Change',
    confirmSubmitChange: (grantId: string) => `Submit permission change for ${grantId}?`,
    quotaTitle: 'Quota Guard',
    quotaUsage: 'Aggregated quota usage',
    usage: 'Usage',
    billingPolicy: 'Billing direction follows port-forwarding account policy.',
    quotaReadModelTitle: 'Live Quota Read Model',
    quotaReadModelHint:
      'Aggregate the real quota state for managed hosts, customer nodes, forwarding accounts, forwarding links, and forwarding rules so operators can inspect usage, billing windows, and disable reasons directly.',
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
      tunnel: 'Forwarding Link',
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
    confirmResetQuota: (name: string) => `Reset quota for ${name}?`,
    quotaResetImpactPreflight: 'Quota Reset Impact Preflight',
    quotaResetImpactHint:
      'Resetting clears the quota read-model counter for the current billing window and writes an execution record. Review target, billing direction, window, and guardrail reason before proceeding.',
    quotaResetImpactTarget: 'Target',
    quotaResetImpactCurrentUsage: 'Current Usage',
    quotaResetImpactUsageRatio: 'Usage Ratio',
    quotaResetImpactBillingDirection: 'Billing Direction',
    quotaResetImpactResetWindow: 'Reset Window',
    quotaResetImpactCurrentState: 'Current State',
    quotaResetImpactGuardrail: 'Guardrail',
    quotaResetImpactPreview: 'Impact Preview',
    quotaResetImpactCounterScope: 'Counter Scope',
    quotaResetImpactReadModelState: 'Read Model State',
    quotaResetImpactRuntimeGuard: 'Runtime Guard',
    quotaResetImpactRuntimeUnchanged: 'Runtime state unchanged',
    quotaResetImpactRuntimeMayResume: 'Backend may resume runtime disablement after reset',
    quotaResetImpactNoGuardrail: 'No guardrail reason',
    scopeTitle: 'Resource Scope',
    sessionsTitle: 'Operator Sessions',
    sessionsSubtitle: 'Server-recorded control-plane sessions can be revoked per session with audit evidence.',
    sessionsLoading: 'Loading operator sessions',
    sessionsEmpty: 'No operator sessions are available.',
    searchSessions: 'Search Operator Sessions',
    searchSessionsPlaceholder: 'Search username, session, source, client, request, or group',
    sessionStatusFilter: 'Session Status',
    allSessionStatuses: 'All statuses',
    matchingSessions: 'Matching',
    noMatchingSessions: 'No matching operator sessions.',
    selectSession: 'Select Session',
    selectVisibleSessions: 'Select Visible Sessions',
    selectedSessions: 'Selected Sessions',
    copySelectedSessionEvidence: 'Copy Selected Session Evidence',
    bulkRevokeSessions: 'Bulk Revoke Sessions',
    confirmBulkRevokeSessions: (count: string) =>
      `Revoke ${count} selected operator session${count === '1' ? '' : 's'}?`,
    sessionBulkImpactPreflight: 'Session Bulk Impact Preflight',
    sessionBulkImpactHint:
      'Estimate revocation impact from selected operator accounts, sources, clients, expiry, and request evidence before executing changes.',
    sessionBulkImpactOperators: 'Affected Operators',
    sessionBulkImpactSources: 'Source Addresses',
    sessionBulkImpactClients: 'Client Fingerprints',
    sessionBulkImpactRequests: 'Request Evidence',
    sessionBulkImpactExpiring: 'Expired/Soon',
    sessionBulkImpactOperatorPreview: 'Operator Preview',
    sessionBulkImpactSourcePreview: 'Source Preview',
    sessionBulkImpactRequestPreview: 'Request Preview',
    currentSession: 'Current Session',
    revokeSession: 'Revoke Session',
    revokeCurrentSession: 'Revoke and Sign Out',
    confirmRevokeSession: (sessionId: string) => `Revoke operator session ${sessionId}?`,
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
    agentCredentialsTitle: 'Agent Runtime Credentials',
    agentCredentialsSubtitle:
      'Inspect sanitized install and runtime credential summaries. The panel only shows tokenPrefix, never raw tokens or tokenHash; revoke and rotate operations append audit-chain evidence.',
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
      install: 'Install',
      runtime: 'Runtime'
    },
    agentCredentialStatus: {
      active: 'Active',
      revoked: 'Revoked',
      expired: 'Expired'
    },
    tokenPrefix: 'Token prefix',
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
    agentSessionUpdatedAt: 'Last activity',
    agentSessionHeartbeatAt: 'Heartbeat',
    agentSessionVersion: 'Agent version',
    agentSessionCapabilities: 'Capabilities',
    agentSessionMissing: 'No session progress yet',
    credentialReplacedBy: 'Replaced by',
    credentialRevokedMeta: (reason: string, actor: string) => `Revocation reason: ${reason} · Actor: ${actor}`,
    revokeCredential: 'Revoke Credential',
    rotateCredential: 'Rotate Credential',
    confirmCredentialOperation: (action: string, credentialId: string) => `${action} ${credentialId}?`,
    credentialOperationPreflight: 'Agent Credential Operation Preflight',
    credentialOperationHint:
      'Rotating or revoking runtime credentials affects Agent sessions, command channels, and installed components. Review the bound session, capabilities, and audit request first.',
    credentialImpactAgent: 'Bound Agent',
    credentialImpactSession: 'Bound Session',
    credentialImpactCapabilities: 'Capabilities',
    credentialImpactTokenPrefix: 'Token Prefix',
    credentialImpactRequest: 'Request Evidence',
    credentialImpactCapabilityPreview: 'Capability Preview',
    credentialImpactLifecyclePreview: 'Lifecycle Preview',
    credentialImpactAuditPreview: 'Audit Preview',
    credentialImpactNoCapabilities: 'No capabilities',
    granted: 'granted',
    denied: 'denied',
    permissionsSafetyCockpit: 'Permissions safety cockpit',
    permissionsControlRail: 'Permissions control rail',
    permissionsEvidenceWorkspace: 'Permissions evidence workspace',
    operator: 'operator',
    group: 'group',
    resourceTypeLabels: {
      agent: 'Agent',
      node: 'Node',
      tunnel: 'Port Forwarding',
      'tunnel-group': 'Forwarding Group',
      subscription: 'Subscription',
      'forward-rule': 'Forward Rule'
    }
  }
} as const;

type PermissionsCopy = (typeof copy)[AppLanguage];
type OperatorSessionBulkImpactSummary = {
  clientLabels: string[];
  expiringSessionCount: number;
  operatorLabels: string[];
  requestLabels: string[];
  sourceLabels: string[];
};
type QuotaResetImpactSummary = {
  billingDirectionLabel: string;
  currentUsageLabel: string;
  guardrailLabel: string;
  impactPreviewLabels: string[];
  resetWindowLabel: string;
  stateLabel: string;
  targetLabel: string;
  usageRatioLabel: string;
};
type AgentCredentialOperationImpactSummary = {
  auditLabels: string[];
  capabilityLabels: string[];
  lifecycleLabels: string[];
  sessionLabel: string;
};

const operatorSessionExpirySoonMs = 24 * 60 * 60 * 1000;

function normalizeGrantSearch(value: string) {
  return value.trim().toLocaleLowerCase();
}

function createGrantSearchText(grant: PermissionGrant, language: AppLanguage, labels: (typeof copy)[AppLanguage]) {
  return [
    grant.id,
    grant.subjectType,
    grant.subjectId,
    formatSubject(grant, labels),
    grant.resourceType,
    formatResourceType(grant.resourceType, language),
    grant.resourceId,
    ...grant.permissions,
    grant.grantedBy,
    grant.reason,
    grant.resourceVersion,
    grant.revokedBy,
    grant.revokedReason
  ]
    .filter(Boolean)
    .join('\n')
    .toLocaleLowerCase();
}

function filterPermissionGrants(
  grants: PermissionGrant[],
  query: string,
  resourceTypeFilter: GrantResourceTypeFilter,
  permissionFilter: GrantPermissionFilter,
  language: AppLanguage,
  labels: (typeof copy)[AppLanguage]
) {
  const normalizedQuery = normalizeGrantSearch(query);

  return grants.filter((grant) => {
    if (resourceTypeFilter !== 'all' && grant.resourceType !== resourceTypeFilter) {
      return false;
    }

    if (permissionFilter !== 'all' && !grant.permissions.includes(permissionFilter)) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return createGrantSearchText(grant, language, labels).includes(normalizedQuery);
  });
}

function createOperatorSessionSearchText(session: OperatorSessionSummary) {
  return [
    session.id,
    session.username,
    session.actor,
    session.operatorGroupId,
    session.resourceGroupId,
    session.status,
    session.sourceIp,
    session.userAgent,
    session.requestId,
    session.revokedBy,
    session.revokedReason
  ]
    .filter(Boolean)
    .join('\n')
    .toLocaleLowerCase();
}

function filterOperatorSessions(
  sessions: OperatorSessionSummary[],
  query: string,
  statusFilter: OperatorSessionStatusFilter
) {
  const normalizedQuery = normalizeGrantSearch(query);

  return sessions.filter((session) => {
    if (statusFilter !== 'all' && session.status !== statusFilter) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return createOperatorSessionSearchText(session).includes(normalizedQuery);
  });
}

function createOperatorSessionEvidenceText(sessions: OperatorSessionSummary[]) {
  return [
    'Operator Session Evidence',
    `Session Count: ${sessions.length}`,
    '',
    ...sessions.map((session) =>
      [
        `- ${session.username}`,
        `  ID: ${session.id}`,
        `  Actor: ${session.actor}`,
        `  Operator Group: ${session.operatorGroupId}`,
        `  Resource Group: ${session.resourceGroupId}`,
        `  Status: ${session.status}`,
        `  Source IP: ${session.sourceIp}`,
        `  Issued At: ${session.issuedAt}`,
        `  Expires At: ${session.expiresAt}`,
        `  Request ID: ${session.requestId}`,
        `  User Agent: ${session.userAgent ?? '-'}`,
        `  Revoked At: ${session.revokedAt ?? '-'}`,
        `  Revoked By: ${session.revokedBy ?? '-'}`,
        `  Revoked Reason: ${session.revokedReason ?? '-'}`
      ].join('\n')
    )
  ].join('\n');
}

function createOperatorSessionBulkImpactSummary(sessions: OperatorSessionSummary[]): OperatorSessionBulkImpactSummary {
  const expiringCutoff = Date.now() + operatorSessionExpirySoonMs;
  const operatorLabels = new Set<string>();
  const sourceLabels = new Set<string>();
  const clientLabels = new Set<string>();
  const requestLabels = new Set<string>();
  let expiringSessionCount = 0;

  sessions.forEach((session) => {
    operatorLabels.add(`${session.username} · ${session.actor}`);
    sourceLabels.add(session.sourceIp);

    if (session.userAgent) {
      clientLabels.add(session.userAgent);
    }

    requestLabels.add(session.requestId);

    const expiresAt = Date.parse(session.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt <= expiringCutoff) {
      expiringSessionCount += 1;
    }
  });

  return {
    clientLabels: Array.from(clientLabels).sort((left, right) => left.localeCompare(right)),
    expiringSessionCount,
    operatorLabels: Array.from(operatorLabels).sort((left, right) => left.localeCompare(right)),
    requestLabels: Array.from(requestLabels).sort((left, right) => left.localeCompare(right)),
    sourceLabels: Array.from(sourceLabels).sort((left, right) => left.localeCompare(right))
  };
}

function createQuotaResetImpactSummary(
  policy: QuotaPolicy,
  labels: PermissionsCopy,
  language: AppLanguage
): QuotaResetImpactSummary {
  const usageRatio = calculateQuotaPolicyUsageRatio(policy);
  const stateLabel = labels.quotaStateLabels[policy.enforcementState];
  const resetWindowLabel =
    policy.resetWindow === 'monthly'
      ? `${labels.quotaResetLabels[policy.resetWindow]} · ${labels.quotaResetDay(policy.resetDay)}`
      : labels.quotaResetLabels[policy.resetWindow];
  const runtimeGuardLabel = policy.runtimeDisabledByPolicy
    ? labels.quotaResetImpactRuntimeMayResume
    : labels.quotaResetImpactRuntimeUnchanged;

  return {
    billingDirectionLabel: formatBillingDirection(policy.billingDirection, language),
    currentUsageLabel: `${formatBytes(policy.usedBytes)} / ${policy.limitBytes > 0 ? formatBytes(policy.limitBytes) : '∞'}`,
    guardrailLabel: policy.guardrailReason ?? labels.quotaResetImpactNoGuardrail,
    impactPreviewLabels: [
      `${labels.quotaResetImpactCounterScope} ${policy.id}`,
      `${labels.quotaResetImpactReadModelState} ${stateLabel}`,
      `${labels.quotaResetImpactRuntimeGuard} ${runtimeGuardLabel}`
    ],
    resetWindowLabel,
    stateLabel,
    targetLabel: `${labels.quotaScopeLabels[policy.scope]} · ${policy.name}`,
    usageRatioLabel: formatPercent(usageRatio * 100)
  };
}

function createAgentCredentialOperationImpactSummary(
  credential: AgentCredentialSummary,
  session: AgentSessionSummary | undefined,
  labels: PermissionsCopy,
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
        credential.lastUsedAt ? formatDateTime(credential.lastUsedAt, language) : '—'
      }`
    ],
    sessionLabel
  };
}

export function PermissionsPage({
  agentCredentials = [],
  agentSessions = [],
  currentOperatorSessionId,
  grants,
  language,
  operatorSessions = [],
  operatorSessionsError,
  operatorSessionsLoading = false,
  quotaPolicies,
  forwardingRules,
  taskMutationBusy = false,
  onRevokeAgentCredential,
  onRevokeOperatorSession,
  onRotateAgentCredential,
  onRunTask,
  onResetQuota
}: PermissionsPageProps) {
  const t = copy[language];
  const [grantSearch, setGrantSearch] = useState('');
  const [grantResourceTypeFilter, setGrantResourceTypeFilter] = useState<GrantResourceTypeFilter>('all');
  const [grantPermissionFilter, setGrantPermissionFilter] = useState<GrantPermissionFilter>('all');
  const [operatorSessionSearch, setOperatorSessionSearch] = useState('');
  const [operatorSessionStatusFilter, setOperatorSessionStatusFilter] = useState<OperatorSessionStatusFilter>('all');
  const [selectedOperatorSessionIds, setSelectedOperatorSessionIds] = useState<string[]>([]);
  const [quotaScopeFilter, setQuotaScopeFilter] = useState<QuotaPolicy['scope'] | 'all'>('all');
  const activeQuotaPolicies = quotaPolicies.filter((policy) => policy.enforcementState === 'active').length;
  const privilegedGrants = grants.filter((grant) => grant.permissions.includes('grant')).length;
  const totalQuota = quotaPolicies.reduce((sum, policy) => sum + policy.limitBytes, 0);
  const usedQuota = quotaPolicies.reduce((sum, policy) => sum + policy.usedBytes, 0);
  const quotaUsage = totalQuota > 0 ? Math.min((usedQuota / totalQuota) * 100, 100) : 0;
  const activeOperatorSessions = operatorSessions.filter((session) => session.status === 'active').length;
  const activeAgentCredentials = agentCredentials.filter((credential) => credential.status === 'active').length;
  const quotaScopeOptions = useMemo(
    () => ['all', ...new Set(quotaPolicies.map((policy) => policy.scope))] as Array<QuotaPolicy['scope'] | 'all'>,
    [quotaPolicies]
  );
  const visibleGrants = useMemo(
    () => filterPermissionGrants(grants, grantSearch, grantResourceTypeFilter, grantPermissionFilter, language, t),
    [grantPermissionFilter, grantResourceTypeFilter, grantSearch, grants, language, t]
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
  const visibleOperatorSessions = useMemo(
    () => filterOperatorSessions(operatorSessions, operatorSessionSearch, operatorSessionStatusFilter),
    [operatorSessionSearch, operatorSessionStatusFilter, operatorSessions]
  );
  const selectedOperatorSessions = useMemo(
    () =>
      operatorSessions.filter(
        (session) =>
          selectedOperatorSessionIds.includes(session.id) &&
          session.status === 'active' &&
          session.id !== currentOperatorSessionId
      ),
    [currentOperatorSessionId, operatorSessions, selectedOperatorSessionIds]
  );
  const operatorSessionBulkImpactSummary = useMemo(
    () => createOperatorSessionBulkImpactSummary(selectedOperatorSessions),
    [selectedOperatorSessions]
  );
  const selectedVisibleOperatorSessionCount = useMemo(
    () =>
      visibleOperatorSessions.filter(
        (session) =>
          selectedOperatorSessionIds.includes(session.id) &&
          session.status === 'active' &&
          session.id !== currentOperatorSessionId
      ).length,
    [currentOperatorSessionId, selectedOperatorSessionIds, visibleOperatorSessions]
  );
  const selectableVisibleOperatorSessionCount = useMemo(
    () =>
      visibleOperatorSessions.filter(
        (session) => session.status === 'active' && session.id !== currentOperatorSessionId
      ).length,
    [currentOperatorSessionId, visibleOperatorSessions]
  );
  const visibleAgentCredentials = useMemo(
    () => [...agentCredentials].sort(compareAgentCredentials),
    [agentCredentials]
  );
  const agentSessionByKey = useMemo(() => {
    const entries = agentSessions.map((session) => [createAgentSessionKey(session.agentId, session.sessionId), session] as const);
    return new Map(entries);
  }, [agentSessions]);

  function toggleOperatorSessionSelection(sessionId: string) {
    setSelectedOperatorSessionIds((current) =>
      current.includes(sessionId) ? current.filter((id) => id !== sessionId) : [...current, sessionId]
    );
  }

  function toggleVisibleOperatorSessionSelection() {
    const visibleIds = visibleOperatorSessions
      .filter((session) => session.status === 'active' && session.id !== currentOperatorSessionId)
      .map((session) => session.id);

    if (visibleIds.length === 0) {
      return;
    }

    setSelectedOperatorSessionIds((current) => {
      const visibleIdSet = new Set(visibleIds);
      const allVisibleSelected = visibleIds.every((id) => current.includes(id));

      return allVisibleSelected
        ? current.filter((id) => !visibleIdSet.has(id))
        : Array.from(new Set([...current, ...visibleIds]));
    });
  }

  function revokeSelectedOperatorSessions() {
    if (selectedOperatorSessions.length === 0) {
      return;
    }

    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(t.confirmBulkRevokeSessions(String(selectedOperatorSessions.length)));

    if (!confirmed) {
      return;
    }

    selectedOperatorSessions.forEach((session) => {
      onRevokeOperatorSession?.(session.id);
    });
  }

  function copySelectedOperatorSessionEvidence() {
    if (selectedOperatorSessions.length === 0 || typeof navigator === 'undefined') {
      return;
    }

    void navigator.clipboard?.writeText(createOperatorSessionEvidenceText(selectedOperatorSessions));
  }

  function revokeOperatorSession(sessionId: string) {
    const confirmed = typeof window === 'undefined' || window.confirm(t.confirmRevokeSession(sessionId));

    if (confirmed) {
      onRevokeOperatorSession?.(sessionId);
    }
  }

  function runAgentCredentialOperation(action: 'rotate' | 'revoke', credentialId: string) {
    const actionLabel = action === 'rotate' ? t.rotateCredential : t.revokeCredential;
    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(t.confirmCredentialOperation(actionLabel, credentialId));

    if (!confirmed) {
      return;
    }

    if (action === 'rotate') {
      onRotateAgentCredential?.(credentialId);
      return;
    }

    onRevokeAgentCredential?.(credentialId);
  }

  function resetQuota(policy: QuotaPolicy) {
    const confirmed = typeof window === 'undefined' || window.confirm(t.confirmResetQuota(policy.name));

    if (!confirmed) {
      return;
    }

    onResetQuota(policy);
  }

  function submitPermissionChange(grant: PermissionGrant) {
    const confirmed = typeof window === 'undefined' || window.confirm(t.confirmSubmitChange(grant.id));

    if (!confirmed) {
      return;
    }

    onRunTask(grant.id);
  }

  return (
    <ResponsivePage className="space-y-5 md:space-y-6">
      <section
        aria-label={t.operationalOverview}
        className="stagger-1 overflow-hidden rounded-[1.5rem] border border-[#07111F] bg-[#FFFDF5] p-5 shadow-[0_18px_55px_rgba(7,17,31,0.08)] backdrop-blur-2xl dark:border-[#6B7CFF]/20 dark:bg-[#101827] dark:shadow-[0_22px_70px_rgba(0,0,0,0.35)] max-md:rounded-2xl max-md:border-[#07111F]/18 max-md:bg-[#FFFDF5]/92 max-md:p-4 max-md:shadow-sm max-md:dark:border-[#6B7CFF]/15 max-md:dark:bg-[#07111F]/88"
      >
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 max-w-3xl">
            <p className="font-mono text-[10px] font-black uppercase tracking-[0.22em] text-[#1E3AFF] dark:text-primary">
              {t.operationalOverview}
            </p>
            <h3 className="mt-3 text-base font-bold text-[#07111F] dark:text-white">{t.title}</h3>
            <p className="mt-2 max-w-4xl text-xs leading-6 text-[#536078] dark:text-white/50">{t.subtitle}</p>
            <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-black text-[#536078] dark:text-white/70">
              {t.operationalSteps.map((step, index) => (
                <span
                  className="shrink-0 rounded-full border border-[#07111F]/18 bg-white/80 px-3 py-1.5 shadow-sm dark:border-white/10 dark:bg-white/[0.04]"
                  key={step}
                >
                  {index + 1}. {step}
                </span>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-bold text-[#536078] dark:text-white/65">
              <span className="rounded-full border border-[#07111F]/18 bg-[#EAF3D1]/35 px-3 py-1.5 dark:border-white/10 dark:bg-white/[0.03]">
                {t.scopedForwarding} {formatNumber(forwardingRules.length)}
              </span>
              <span className="rounded-full border border-[#07111F]/18 bg-[#EAF3D1]/35 px-3 py-1.5 dark:border-white/10 dark:bg-white/[0.03]">
                {t.quotaUsage} {formatPercent(quotaUsage)}
              </span>
              <span className="rounded-full border border-[#07111F]/18 bg-[#EAF3D1]/35 px-3 py-1.5 dark:border-white/10 dark:bg-white/[0.03]">
                {t.leastPrivilege}
              </span>
            </div>
          </div>

          <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:w-[34rem] xl:grid-cols-1 2xl:grid-cols-2">
            <SummaryCard icon={UsersRound} label={t.subjects} value={formatNumber(grants.length)} />
            <SummaryCard icon={ShieldCheck} label={t.delegatedRoles} value={formatNumber(privilegedGrants)} />
            <SummaryCard icon={LockKeyhole} label={t.quotaPolicies} value={`${activeQuotaPolicies}/${quotaPolicies.length}`} />
            <SummaryCard icon={KeyRound} label={t.sessionsTitle} value={`${activeOperatorSessions}/${operatorSessions.length}`} />
            <SummaryCard icon={KeyRound} label={t.agentCredentials} value={`${activeAgentCredentials}/${agentCredentials.length}`} />
          </div>
        </div>
      </section>

      <WorkspaceCockpit aria-label={t.permissionsSafetyCockpit} className="permissions-safety-cockpit stagger-2">
        <div className="grid min-h-0 grid-cols-1 xl:grid-cols-[21rem_minmax(0,1fr)]">
          <aside
            aria-label={t.permissionsControlRail}
            className="permissions-safety-rail border-b border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.02] xl:border-b-0 xl:border-r"
            role="complementary"
          >
            <div className="flex flex-col gap-4 xl:sticky xl:top-0">
              <div className="rounded-xl border border-slate-200 bg-white/75 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-blue-200 bg-white text-blue-600 shadow-sm dark:border-primary/20 dark:bg-primary/10 dark:text-primary">
                    <ShieldCheck className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{t.title}</p>
                    <p className="mt-1 truncate text-[11px] font-semibold text-slate-500 dark:text-white/45">
                      {t.leastPrivilege}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-2">
                  <ControlRailMetric icon={UsersRound} label={t.subjects} value={formatNumber(grants.length)} />
                  <ControlRailMetric icon={ShieldCheck} label={t.delegatedRoles} value={formatNumber(privilegedGrants)} />
                  <ControlRailMetric
                    icon={KeyRound}
                    label={t.agentCredentials}
                    value={`${activeAgentCredentials}/${agentCredentials.length}`}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white/75 p-4 dark:border-white/10 dark:bg-white/[0.03]">
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
                  {t.usage} {formatPercent(quotaUsage)} · {activeQuotaPolicies}/{quotaPolicies.length}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white/75 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="mb-4 flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-blue-500 dark:text-primary" />
                  <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.scopeTitle}</h4>
                </div>
                <div className="grid gap-2">
                  <ControlRailMetric icon={KeyRound} label={t.scopedForwarding} value={formatNumber(forwardingRules.length)} />
                  <ControlRailMetric icon={LockKeyhole} label={t.quotaPolicies} value={formatNumber(quotaPolicies.length)} />
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-white/45">{t.operationalOverviewHint}</p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white/75 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="mb-4 flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-blue-500 dark:text-primary" />
                  <p className="text-sm font-bold text-slate-800 dark:text-white">{t.sessionsTitle}</p>
                </div>
                <div className="grid gap-2">
                  <ControlRailMetric
                    icon={KeyRound}
                    label={t.sessionStatus.active}
                    value={`${activeOperatorSessions}/${operatorSessions.length}`}
                  />
                  <ControlRailMetric
                    icon={Ban}
                    label={t.selectedSessions}
                    value={formatNumber(selectedOperatorSessions.length, language)}
                  />
                </div>
                {operatorSessionsLoading ? (
                  <p className="mt-3 text-xs font-semibold text-slate-500 dark:text-white/45">{t.sessionsLoading}</p>
                ) : operatorSessionsError ? (
                  <p className="mt-3 text-xs font-semibold text-red-600 dark:text-red-300">{operatorSessionsError}</p>
                ) : null}
              </div>
            </div>
          </aside>

          <WorkspaceCockpitScroller aria-label={t.permissionsEvidenceWorkspace} className="permissions-safety-workspace min-h-0">
            <div className="space-y-5 p-4">
      <section className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <GlassCard aria-label={t.matrixTitle} className="permissions-safety-grants-panel p-5" role="group">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#1E3AFF] dark:text-primary" />
              <h4 className="text-sm font-bold text-[#07111F] dark:text-white">{t.matrixTitle}</h4>
            </div>
            <span className="rounded-full bg-[#DCE1FF] px-3 py-1 text-[10px] font-bold text-[#1E3AFF] dark:bg-primary/15 dark:text-primary">
              {t.leastPrivilege}
            </span>
          </div>

          <div className="mb-4 rounded-xl border border-[#07111F]/18 bg-[#EAF3D1]/35 p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(16rem,1fr)_minmax(10rem,0.32fr)_minmax(10rem,0.32fr)]">
              <label className="block rounded-lg border border-[#07111F]/18 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#536078] dark:text-white/40">
                  {t.searchGrants}
                </span>
                <div className="mt-1 flex min-h-7 items-center gap-2">
                  <Search className="h-3.5 w-3.5 shrink-0 text-[#7B859B] dark:text-white/35" />
                  <input
                    aria-label={t.searchGrants}
                    className="w-full bg-transparent text-sm font-semibold text-[#07111F] outline-none placeholder:text-[#7B859B] dark:text-white dark:placeholder:text-white/35"
                    onChange={(event) => setGrantSearch(event.target.value)}
                    placeholder={t.searchGrantsPlaceholder}
                    type="search"
                    value={grantSearch}
                  />
                </div>
              </label>
              <label className="block rounded-lg border border-[#07111F]/18 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#536078] dark:text-white/40">
                  {t.resourceType}
                </span>
                <select
                  aria-label={t.resourceType}
                  className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-[#07111F] outline-none dark:text-white"
                  onChange={(event) => setGrantResourceTypeFilter(event.target.value as GrantResourceTypeFilter)}
                  value={grantResourceTypeFilter}
                >
                  <option value="all">{t.allResourceTypes}</option>
                  {grantResourceTypes.map((resourceType) => (
                    <option key={resourceType} value={resourceType}>
                      {t.resourceTypeLabels[resourceType]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block rounded-lg border border-[#07111F]/18 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#536078] dark:text-white/40">
                  {t.requiredPermission}
                </span>
                <select
                  aria-label={t.requiredPermission}
                  className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-[#07111F] outline-none dark:text-white"
                  onChange={(event) => setGrantPermissionFilter(event.target.value as GrantPermissionFilter)}
                  value={grantPermissionFilter}
                >
                  <option value="all">{t.allPermissions}</option>
                  {permissionOrder.map((permission) => (
                    <option key={permission} value={permission}>
                      {permission}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-3 text-xs font-bold uppercase tracking-widest text-[#536078] dark:text-white/40">
              {t.matchingGrants} {visibleGrants.length} / {grants.length}
            </p>
          </div>

          <div className="space-y-3">
            {visibleGrants.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#07111F]/30 p-5 text-sm font-semibold text-[#536078] dark:border-white/10 dark:text-white/45">
                {t.noMatchingGrants}
              </div>
            ) : (
              visibleGrants.map((grant) => (
                <article
                  aria-label={grant.id}
                  key={grant.id}
                  className="permissions-safety-grant-row rounded-xl border border-[#07111F]/18 p-4 transition-colors hover:bg-[#EAF3D1]/35 dark:border-white/10 dark:hover:bg-white/[0.03]"
                >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-all text-sm font-bold text-[#07111F] dark:text-white">
                          <span>{formatSubject(grant, t)}</span>
                          <span> → {grant.resourceId}</span>
                        </p>
                        <p className="mt-1 break-all font-mono text-[11px] text-[#536078] dark:text-white/45">
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
                    <p className="min-w-0 text-xs text-[#536078] dark:text-white/50">
                      {t.rowHint}
                    </p>
                    <GlowButton
                      className="px-4 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={taskMutationBusy}
                      onClick={() => submitPermissionChange(grant)}
                    >
                      {t.submitChange}
                    </GlowButton>
                  </div>
                </article>
              ))
            )}
          </div>
        </GlassCard>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 2xl:grid-cols-1">
          <GlassCard className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <LockKeyhole className="h-4 w-4 text-[#1E3AFF] dark:text-primary" />
              <h4 className="text-sm font-bold text-[#07111F] dark:text-white">{t.quotaTitle}</h4>
            </div>
            <div className="mb-2 flex justify-between text-xs text-[#536078] dark:text-white/50">
              <span>{t.quotaUsage}</span>
              <span>
                {formatBytes(usedQuota)} / {formatBytes(totalQuota)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#DCE1FF] dark:bg-white/10">
              <div className="h-full rounded-full bg-[#1E3AFF] dark:bg-[#6B7CFF]" style={{ width: `${quotaUsage}%` }} />
            </div>
            <p className="mt-3 text-[11px] text-[#536078] dark:text-white/45">
              {t.usage} {formatPercent(quotaUsage)} · {t.billingPolicy}
            </p>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-[#1E3AFF] dark:text-primary" />
              <h4 className="text-sm font-bold text-[#07111F] dark:text-white">{t.scopeTitle}</h4>
            </div>
            <div className="space-y-3">
              {forwardingRules.slice(0, 4).map((rule) => (
                <div key={rule.id} className="rounded-xl border border-[#07111F]/18 p-3 dark:border-white/10">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#07111F] dark:text-white/80">{rule.name}</p>
                      <p className="mt-1 break-all font-mono text-[10px] text-[#536078] dark:text-white/45">
                        {rule.sourceAddress}:{rule.listenPort} → {rule.targetAddress}:{rule.targetPort}
                      </p>
                    </div>
                    <span className="text-[10px] font-bold uppercase text-[#536078] dark:text-white/50">
                      {rule.billingDirection}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard aria-label={t.sessionsTitle} className="permissions-safety-sessions-panel p-5" role="region">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-[#1E3AFF] dark:text-primary" />
                  <h4 className="text-sm font-bold text-[#07111F] dark:text-white">{t.sessionsTitle}</h4>
                </div>
                <p className="mt-2 text-xs text-[#536078] dark:text-white/45">{t.sessionsSubtitle}</p>
              </div>
              <span className="rounded-full bg-[#DCE1FF] px-3 py-1 text-[10px] font-bold text-[#1E3AFF] dark:bg-primary/15 dark:text-primary">
                {activeOperatorSessions}/{operatorSessions.length}
              </span>
            </div>

            {operatorSessionsLoading ? (
              <p className="text-xs text-[#536078] dark:text-white/45">{t.sessionsLoading}</p>
            ) : operatorSessionsError ? (
              <p className="text-xs text-red-600 dark:text-red-300">{operatorSessionsError}</p>
            ) : operatorSessions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#07111F]/30 p-4 text-xs text-[#536078] dark:border-white/10 dark:text-white/45">
                {t.sessionsEmpty}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border border-[#07111F]/18 bg-[#EAF3D1]/35 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(16rem,1fr)_minmax(9rem,0.36fr)]">
                    <label className="block rounded-lg border border-[#07111F]/18 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#536078] dark:text-white/40">
                        {t.searchSessions}
                      </span>
                      <div className="mt-1 flex min-h-7 items-center gap-2">
                        <Search className="h-3.5 w-3.5 shrink-0 text-[#7B859B] dark:text-white/35" />
                        <input
                          aria-label={t.searchSessions}
                          className="w-full bg-transparent text-sm font-semibold text-[#07111F] outline-none placeholder:text-[#7B859B] dark:text-white dark:placeholder:text-white/35"
                          onChange={(event) => setOperatorSessionSearch(event.target.value)}
                          placeholder={t.searchSessionsPlaceholder}
                          type="search"
                          value={operatorSessionSearch}
                        />
                      </div>
                    </label>
                    <label className="block rounded-lg border border-[#07111F]/18 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#536078] dark:text-white/40">
                        {t.sessionStatusFilter}
                      </span>
                      <select
                        aria-label={t.sessionStatusFilter}
                        className="ou-select mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-[#07111F] outline-none dark:text-white"
                        onChange={(event) => setOperatorSessionStatusFilter(event.target.value as OperatorSessionStatusFilter)}
                        value={operatorSessionStatusFilter}
                      >
                        <option value="all">{t.allSessionStatuses}</option>
                        {operatorSessionStatuses.map((status) => (
                          <option key={status} value={status}>
                            {t.sessionStatus[status]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs font-bold uppercase tracking-widest text-[#536078] dark:text-white/40">
                      {t.matchingSessions} {visibleOperatorSessions.length} / {operatorSessions.length}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex items-center gap-2 text-xs font-bold text-[#536078] dark:text-white/60">
                        <input
                          aria-label={t.selectVisibleSessions}
                          checked={
                            selectableVisibleOperatorSessionCount > 0 &&
                            selectedVisibleOperatorSessionCount === selectableVisibleOperatorSessionCount
                          }
                          className="h-4 w-4 rounded border-[#07111F]/30 text-[#1E3AFF] focus:ring-[#1E3AFF]"
                          disabled={selectableVisibleOperatorSessionCount === 0 || !onRevokeOperatorSession}
                          onChange={toggleVisibleOperatorSessionSelection}
                          type="checkbox"
                        />
                        {t.selectVisibleSessions}
                      </label>
                      <span className="rounded-full bg-[#DCE1FF] px-3 py-1 text-xs font-bold text-[#1E3AFF] dark:bg-primary/15 dark:text-primary">
                        {t.selectedSessions} {selectedOperatorSessions.length}
                      </span>
                      <button
                        className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-[#07111F]/18 bg-white px-3 text-xs font-bold text-[#536078] transition hover:bg-[#EAF3D1]/35 hover:text-[#1E3AFF] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
                        disabled={selectedOperatorSessions.length === 0}
                        onClick={copySelectedOperatorSessionEvidence}
                        type="button"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {t.copySelectedSessionEvidence}
                      </button>
                      <button
                        className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-[#07111F]/18 bg-white px-3 text-xs font-bold text-[#536078] transition hover:bg-[#EAF3D1]/35 hover:text-[#1E3AFF] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
                        disabled={selectedOperatorSessions.length === 0 || taskMutationBusy || !onRevokeOperatorSession}
                        onClick={revokeSelectedOperatorSessions}
                        type="button"
                      >
                        <Ban className="h-3.5 w-3.5" />
                        {t.bulkRevokeSessions}
                      </button>
                    </div>
                  </div>
                </div>

                {selectedOperatorSessions.length > 0 ? (
                  <OperatorSessionBulkImpactPreflight
                    language={language}
                    selectedCount={selectedOperatorSessions.length}
                    summary={operatorSessionBulkImpactSummary}
                    t={t}
                  />
                ) : null}

                {visibleOperatorSessions.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#07111F]/30 p-4 text-xs text-[#536078] dark:border-white/10 dark:text-white/45">
                    {t.noMatchingSessions}
                  </div>
                ) : null}

                {visibleOperatorSessions.map((session) => {
                  const isCurrentSession = session.id === currentOperatorSessionId;
                  const disabled = session.status !== 'active' || taskMutationBusy || !onRevokeOperatorSession;
                  const canSelect = session.status === 'active' && !isCurrentSession && Boolean(onRevokeOperatorSession);

                  return (
                    <article
                      aria-label={session.id}
                      className="permissions-safety-session-row rounded-xl border border-[#07111F]/18 p-4 dark:border-white/10"
                      key={session.id}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <input
                            aria-label={`${t.selectSession} ${session.id}`}
                            checked={selectedOperatorSessionIds.includes(session.id)}
                            className="mt-1 h-4 w-4 rounded border-[#07111F]/30 text-[#1E3AFF] focus:ring-[#1E3AFF]"
                            disabled={!canSelect}
                            onChange={() => toggleOperatorSessionSelection(session.id)}
                            type="checkbox"
                          />
                          <div className="min-w-0">
                            <p className="break-all text-sm font-bold text-[#07111F] dark:text-white">
                              {session.username}
                              <span className="text-[#536078] dark:text-white/45"> · {session.actor}</span>
                            </p>
                            <p className="mt-1 break-all font-mono text-[11px] text-[#536078] dark:text-white/45">
                              {session.id}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {isCurrentSession ? (
                            <span className="rounded-full bg-[#DCE1FF] px-3 py-1 text-[10px] font-bold text-[#1E3AFF] dark:bg-primary/15 dark:text-primary">
                              {t.currentSession}
                            </span>
                          ) : null}
                          <span className="rounded-full bg-[#EAF3D1] px-3 py-1 text-[10px] font-bold uppercase text-[#536078] dark:bg-white/10 dark:text-white/70">
                            {t.sessionStatus[session.status]}
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-2 text-[11px] text-[#536078] dark:text-white/45">
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
      </section>

      <GlassCard aria-label={t.agentCredentialsTitle} className="permissions-safety-credentials-panel stagger-3 p-5" role="group">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-[#1E3AFF] dark:text-primary" />
              <h4 className="text-sm font-bold text-[#07111F] dark:text-white">{t.agentCredentialsTitle}</h4>
            </div>
            <p className="mt-2 max-w-4xl text-xs text-[#536078] dark:text-white/45">{t.agentCredentialsSubtitle}</p>
          </div>
          <span className="rounded-full bg-[#DCE1FF] px-3 py-1 text-[10px] font-bold text-[#1E3AFF] dark:bg-primary/15 dark:text-primary">
            {activeAgentCredentials}/{agentCredentials.length}
          </span>
        </div>

        {visibleAgentCredentials.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#07111F]/30 p-4 text-xs text-[#536078] dark:border-white/10 dark:text-white/45">
            {t.agentCredentialsEmpty}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left">
              <thead className="text-[11px] uppercase tracking-[0.24em] text-[#536078] dark:text-white/35">
                <tr>
                  <th className="px-4 py-3">{t.agentCredentialColumns.identity}</th>
                  <th className="px-4 py-3">{t.agentCredentialColumns.token}</th>
                  <th className="px-4 py-3">{t.agentCredentialColumns.lifecycle}</th>
                  <th className="px-4 py-3">{t.agentCredentialColumns.session}</th>
                  <th className="px-4 py-3">{t.agentCredentialColumns.audit}</th>
                  <th className="px-4 py-3">{t.agentCredentialColumns.action}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#07111F]/12 text-sm text-[#35405A] dark:divide-white/10 dark:text-white/75">
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
                      <tr className="permissions-safety-credential-row">
                        <td className="px-4 py-4 align-top">
                          <div className="min-w-0">
                            <p className="break-all font-semibold text-[#07111F] dark:text-white">
                              {credential.agentId}
                            </p>
                            <p className="mt-1 break-all font-mono text-[11px] text-[#7B859B] dark:text-white/30">
                              {credential.id}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <span className="rounded-full bg-[#EAF3D1] px-3 py-1 text-[10px] font-bold uppercase text-[#536078] dark:bg-white/10 dark:text-white/70">
                                {t.agentCredentialPurpose[credential.purpose]}
                              </span>
                              <span className={agentCredentialStatusClassName(credential.status)}>
                                {t.agentCredentialStatus[credential.status]}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top text-xs text-[#536078] dark:text-white/45">
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
                        <td className="px-4 py-4 align-top text-xs text-[#536078] dark:text-white/45">
                          <div className="space-y-2">
                            <p>
                              {t.credentialIssuedAt} {formatDateTime(credential.issuedAt, language)}
                            </p>
                            <p>
                              {t.credentialExpiresAt} {formatDateTime(credential.expiresAt, language)}
                            </p>
                            <p>
                              {t.credentialLastUsedAt}{' '}
                              {credential.lastUsedAt ? formatDateTime(credential.lastUsedAt, language) : '—'}
                            </p>
                            {credential.revokedAt ? (
                              <p>
                                {formatDateTime(credential.revokedAt, language)} ·{' '}
                                {t.credentialRevokedMeta(credential.revokedReason ?? '-', credential.revokedBy ?? '-')}
                              </p>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top text-xs text-[#536078] dark:text-white/45">
                          <div className="space-y-2">
                            <p className="break-all">
                              {t.credentialSession} {credential.sessionId ?? t.credentialNoSession}
                            </p>
                            {boundSession ? (
                              <div className="space-y-1 rounded-xl border border-[#07111F]/18 bg-white/50 p-3 dark:border-white/10 dark:bg-white/5">
                                <p>
                                  <span className={agentSessionStatusClassName(boundSession.status)}>
                                    {t.agentSessionStatus[boundSession.status]}
                                  </span>
                                </p>
                                <p>
                                  {t.agentSessionLastSeq} {formatNumber(boundSession.lastSeq)} ·{' '}
                                  {t.agentSessionLastCommandSeq}{' '}
                                  {boundSession.lastSeenCommandSeq !== undefined
                                    ? formatNumber(boundSession.lastSeenCommandSeq)
                                    : '—'}
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
                        <td className="px-4 py-4 align-top text-xs text-[#536078] dark:text-white/45">
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

      <GlassCard aria-label={t.quotaReadModelTitle} className="permissions-safety-quota-panel stagger-3 p-5" role="group">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-[#07111F] dark:text-white">{t.quotaReadModelTitle}</h4>
            <p className="mt-1 max-w-4xl text-xs text-[#536078] dark:text-white/50">{t.quotaReadModelHint}</p>
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
          <div className="rounded-xl border border-dashed border-[#07111F]/30 p-4 text-xs text-[#536078] dark:border-white/10 dark:text-white/45">
            {t.quotaPoliciesEmpty}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left">
              <thead className="text-[11px] uppercase tracking-[0.24em] text-[#536078] dark:text-white/35">
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
              <tbody className="divide-y divide-[#07111F]/12 text-sm text-[#35405A] dark:divide-white/10 dark:text-white/75">
                {visibleQuotaPolicies.map((policy) => {
                  const usageRatio = calculateQuotaPolicyUsageRatio(policy);

                  return (
                    <Fragment key={policy.id}>
                      <tr className="permissions-safety-quota-row">
                        <td className="px-4 py-4 align-top">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-[#07111F] dark:text-white">{policy.name}</p>
                            {policy.detail ? (
                              <p className="mt-1 truncate text-xs text-[#536078] dark:text-white/45">{policy.detail}</p>
                            ) : null}
                            <p className="mt-1 truncate font-mono text-[11px] text-[#7B859B] dark:text-white/30">{policy.id}</p>
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top text-xs text-[#536078] dark:text-white/45">
                          <div>
                            <p>{t.quotaScopeLabels[policy.scope]}</p>
                            {t.quotaSourceCount(policy.sourceCount) ? <p className="mt-1">{t.quotaSourceCount(policy.sourceCount)}</p> : null}
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <div className="min-w-[240px]">
                            <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                              <span className="font-semibold text-[#07111F] dark:text-white">{formatBytes(policy.usedBytes)}</span>
                              <span className="text-[#536078] dark:text-white/45">
                                {policy.limitBytes > 0 ? formatBytes(policy.limitBytes) : '∞'}
                              </span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-[#DCE1FF] dark:bg-white/10">
                              <div
                                className={
                                  policy.enforcementState === 'disabled_by_quota'
                                    ? 'h-full rounded-full bg-[#FF3D18]'
                                    : policy.enforcementState === 'exceeded'
                                      ? 'h-full rounded-full bg-[#D9FF00]'
                                      : 'h-full rounded-full bg-[#1E3AFF] dark:bg-[#6B7CFF]'
                                }
                                style={{ width: `${Math.max(usageRatio * 100, policy.usedBytes > 0 ? 4 : 0)}%` }}
                              />
                            </div>
                            <p className="mt-2 text-[11px] text-[#536078] dark:text-white/45">{formatPercent(usageRatio * 100)}</p>
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top text-xs">{formatBillingDirection(policy.billingDirection, language)}</td>
                        <td className="px-4 py-4 align-top text-xs text-[#536078] dark:text-white/45">
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
                            <p className="mt-2 break-all text-[11px] text-[#536078] dark:text-white/45">{policy.guardrailReason}</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-4 align-top text-xs text-[#536078] dark:text-white/45">
                          {policy.reportedAt ? formatDateTime(policy.reportedAt, language) : '—'}
                        </td>
                        <td className="px-4 py-4 align-top">
                          <GlowButton
                            className="inline-flex items-center gap-2 px-3 py-2 text-[11px] font-bold disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={taskMutationBusy}
                            onClick={() => resetQuota(policy)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            {t.resetQuota}
                          </GlowButton>
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 pb-4 pt-0" colSpan={8}>
                          <QuotaResetImpactPreflight language={language} policy={policy} t={t} />
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
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

function SummaryCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof UsersRound }) {
  return (
    <GlassCard className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#536078] dark:text-[#B8C2E6]/65">{label}</p>
          <p className="mt-3 text-xl font-black text-[#07111F] dark:text-[#F4F8FF]">{value}</p>
        </div>
        <Icon className="h-5 w-5 text-[#1E3AFF] dark:text-[#6B7CFF]" />
      </div>
    </GlassCard>
  );
}

function ControlRailMetric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof UsersRound }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-white/10">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-white/35" />
        <span className="truncate text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
          {label}
        </span>
      </div>
      <span className="shrink-0 text-sm font-black text-slate-900 dark:text-white">{value}</span>
    </div>
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
          ? 'rounded-xl border border-[#1E3AFF]/20 bg-[#DCE1FF]/55 p-3 dark:border-[#6B7CFF]/20 dark:bg-[#6B7CFF]/15'
          : 'rounded-xl border border-[#07111F]/18 bg-[#FFFDF5] p-3 opacity-50 dark:border-white/10'
      }
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#536078] dark:text-[#B8C2E6]/65">{label}</p>
      <p className="mt-1 text-xs font-black text-[#07111F] dark:text-[#F4F8FF]">
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
          ? 'rounded-xl bg-[#1E3AFF] px-4 py-2 text-xs font-bold text-white shadow-lg shadow-[#1E3AFF]/20 dark:bg-[#6B7CFF] dark:text-[#07111F]'
          : 'rounded-xl border border-[#07111F]/18 bg-[#FFFDF5]/72 px-4 py-2 text-xs font-bold text-[#536078] transition hover:text-[#1E3AFF] dark:border-white/10 dark:bg-white/5 dark:text-white/50 dark:hover:text-[#6B7CFF]'
      }
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function QuotaResetImpactPreflight({
  language,
  policy,
  t
}: {
  language: AppLanguage;
  policy: QuotaPolicy;
  t: PermissionsCopy;
}) {
  const summary = createQuotaResetImpactSummary(policy, t, language);

  return (
    <section
      aria-label={t.quotaResetImpactPreflight}
      className="rounded-xl border border-[#D9FF00] bg-[#D9FF00]/10 p-4 dark:border-[#E9FF6A]/20 dark:bg-[#E9FF6A]/10"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-[#788800] dark:text-[#E9FF6A]">
            {t.quotaResetImpactPreflight}
          </p>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[#35405A] dark:text-[#D8E0FF]/70">
            {t.quotaResetImpactHint}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full border border-[#D9FF00] bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-bold text-[#07111F] dark:border-[#E9FF6A]/20 dark:bg-white/[0.04] dark:text-white/70">
              {summary.targetLabel}
            </span>
            <span className="rounded-full border border-[#D9FF00] bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-bold text-[#07111F] dark:border-[#E9FF6A]/20 dark:bg-white/[0.04] dark:text-white/70">
              {summary.currentUsageLabel}
            </span>
            <span className="rounded-full border border-[#D9FF00] bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-bold text-[#07111F] dark:border-[#E9FF6A]/20 dark:bg-white/[0.04] dark:text-white/70">
              {summary.stateLabel}
            </span>
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2 xl:w-[28rem]">
          <QuotaResetImpactMetric label={t.quotaResetImpactTarget} value={summary.targetLabel} />
          <QuotaResetImpactMetric label={t.quotaResetImpactCurrentUsage} value={summary.currentUsageLabel} />
          <QuotaResetImpactMetric label={t.quotaResetImpactUsageRatio} value={summary.usageRatioLabel} />
          <QuotaResetImpactMetric label={t.quotaResetImpactBillingDirection} value={summary.billingDirectionLabel} />
          <QuotaResetImpactMetric label={t.quotaResetImpactResetWindow} value={summary.resetWindowLabel} />
          <QuotaResetImpactMetric label={t.quotaResetImpactCurrentState} value={summary.stateLabel} />
          <QuotaResetImpactMetric label={t.quotaResetImpactGuardrail} value={summary.guardrailLabel} />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <QuotaResetImpactPreview title={t.quotaResetImpactPreview} values={summary.impactPreviewLabels} />
      </div>
    </section>
  );
}

function QuotaResetImpactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[#D9FF00]/20 bg-[#FFFDF5]/80 px-3 py-2 dark:border-[#E9FF6A]/20 dark:bg-white/[0.035]">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#536078] dark:text-[#B8C2E6]/65">{label}</p>
      <p className="mt-1 break-all text-sm font-black text-[#07111F] dark:text-[#F4F8FF]">{value}</p>
      <span className="sr-only">
        {label} {value}
      </span>
    </div>
  );
}

function QuotaResetImpactPreview({ title, values }: { title: string; values: string[] }) {
  return (
    <div className="min-w-0 rounded-lg border border-[#D9FF00]/20 bg-[#FFFDF5]/70 p-3 dark:border-[#E9FF6A]/20 dark:bg-white/[0.025]">
      <p className="text-[10px] font-black uppercase tracking-widest text-[#536078] dark:text-[#B8C2E6]/65">{title}</p>
      <div className="mt-2 space-y-1 text-[#35405A] dark:text-[#D8E0FF]/72">
        {values.map((value) => (
          <p className="truncate text-xs font-bold" key={value} title={value}>
            {value}
          </p>
        ))}
      </div>
    </div>
  );
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
  t: PermissionsCopy;
}) {
  const summary = createAgentCredentialOperationImpactSummary(credential, session, t, language);
  const capabilityPreviewValues =
    summary.capabilityLabels.length > 0
      ? summary.capabilityLabels.slice(0, 5)
      : [t.credentialImpactNoCapabilities];

  return (
    <section
      aria-label={t.credentialOperationPreflight}
      className="rounded-xl border border-[#FF3D18] bg-[#FF3D18]/10 p-4 dark:border-[#FFB299]/20 dark:bg-[#FFB299]/10"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-[#B93C17] dark:text-[#FFB299]">
            {t.credentialOperationPreflight}
          </p>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[#35405A] dark:text-[#D8E0FF]/70">
            {t.credentialOperationHint}
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
              <span className="rounded-full border border-[#FF3D18] bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-bold text-[#536078] dark:border-[#FFB299]/20 dark:bg-white/[0.04] dark:text-white/50">
                +{formatNumber(summary.capabilityLabels.length - 4, language)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2 xl:w-[24rem]">
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
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <AgentCredentialOperationPreview title={t.credentialImpactCapabilityPreview} values={capabilityPreviewValues} />
        <AgentCredentialOperationPreview
          title={t.credentialImpactLifecyclePreview}
          values={summary.lifecycleLabels}
        />
        <AgentCredentialOperationPreview title={t.credentialImpactAuditPreview} values={summary.auditLabels} />
      </div>
    </section>
  );
}

function AgentCredentialOperationMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[#FF3D18]/20 bg-[#FFFDF5]/80 px-3 py-2 dark:border-[#FFB299]/20 dark:bg-white/[0.035]">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#536078] dark:text-[#B8C2E6]/65">{label}</p>
      <p className="mt-1 break-all text-sm font-black text-[#07111F] dark:text-[#F4F8FF]">{value}</p>
      <span className="sr-only">
        {label} {value}
      </span>
    </div>
  );
}

function AgentCredentialOperationPreview({ title, values }: { title: string; values: string[] }) {
  return (
    <div className="min-w-0 rounded-lg border border-[#FF3D18]/20 bg-[#FFFDF5]/70 p-3 dark:border-[#FFB299]/20 dark:bg-white/[0.025]">
      <p className="text-[10px] font-black uppercase tracking-widest text-[#536078] dark:text-[#B8C2E6]/65">{title}</p>
      <div className="mt-2 space-y-1 text-[#35405A] dark:text-[#D8E0FF]/72">
        {values.map((value) => (
          <p className="truncate text-xs font-bold" key={value} title={value}>
            {value}
          </p>
        ))}
      </div>
    </div>
  );
}

function OperatorSessionBulkImpactPreflight({
  language,
  selectedCount,
  summary,
  t
}: {
  language: AppLanguage;
  selectedCount: number;
  summary: OperatorSessionBulkImpactSummary;
  t: PermissionsCopy;
}) {
  return (
    <section
      aria-label={t.sessionBulkImpactPreflight}
      className="rounded-xl border border-[#1E3AFF] bg-[#DCE1FF]/55 p-4 dark:border-[#6B7CFF]/20 dark:bg-[#6B7CFF]/12"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-[#1E3AFF] dark:text-[#6B7CFF]">
            {t.sessionBulkImpactPreflight}
          </p>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[#35405A] dark:text-[#D8E0FF]/70">
            {t.sessionBulkImpactHint}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.sourceLabels.slice(0, 4).map((label) => (
              <span
                className="rounded-full border border-[#1E3AFF]/20 bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-bold text-[#07111F] dark:border-[#6B7CFF]/20 dark:bg-white/[0.04] dark:text-white/70"
                key={label}
              >
                {label}
              </span>
            ))}
            {summary.sourceLabels.length > 4 ? (
              <span className="rounded-full border border-[#1E3AFF]/20 bg-[#FFFDF5] px-2.5 py-1 text-[11px] font-bold text-[#536078] dark:border-[#6B7CFF]/20 dark:bg-white/[0.04] dark:text-white/50">
                +{formatNumber(summary.sourceLabels.length - 4, language)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2 xl:w-[22rem]">
          <OperatorSessionBulkImpactMetric
            label={t.sessionBulkImpactOperators}
            value={formatNumber(summary.operatorLabels.length, language)}
          />
          <OperatorSessionBulkImpactMetric
            label={t.sessionBulkImpactSources}
            value={formatNumber(summary.sourceLabels.length, language)}
          />
          <OperatorSessionBulkImpactMetric
            label={t.sessionBulkImpactClients}
            value={formatNumber(summary.clientLabels.length, language)}
          />
          <OperatorSessionBulkImpactMetric
            label={t.sessionBulkImpactRequests}
            value={formatNumber(summary.requestLabels.length, language)}
          />
          <OperatorSessionBulkImpactMetric label={t.selectedSessions} value={formatNumber(selectedCount, language)} />
          <OperatorSessionBulkImpactMetric
            label={t.sessionBulkImpactExpiring}
            value={formatNumber(summary.expiringSessionCount, language)}
          />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <OperatorSessionBulkImpactPreview
          title={t.sessionBulkImpactOperatorPreview}
          values={summary.operatorLabels.slice(0, 5)}
        />
        <OperatorSessionBulkImpactPreview
          title={t.sessionBulkImpactSourcePreview}
          values={summary.sourceLabels.slice(0, 5)}
        />
        <OperatorSessionBulkImpactPreview
          title={t.sessionBulkImpactRequestPreview}
          values={summary.requestLabels.slice(0, 5)}
          warning={summary.expiringSessionCount > 0}
        />
      </div>
    </section>
  );
}

function OperatorSessionBulkImpactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[#1E3AFF]/20 bg-[#FFFDF5]/80 px-3 py-2 dark:border-[#6B7CFF]/20 dark:bg-white/[0.035]">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#536078] dark:text-[#B8C2E6]/65">{label}</p>
      <p className="mt-1 break-all text-sm font-black text-[#07111F] dark:text-[#F4F8FF]">{value}</p>
      <span className="sr-only">
        {label} {value}
      </span>
    </div>
  );
}

function OperatorSessionBulkImpactPreview({
  title,
  values,
  warning = false
}: {
  title: string;
  values: string[];
  warning?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-[#1E3AFF]/20 bg-[#FFFDF5]/70 p-3 dark:border-[#6B7CFF]/20 dark:bg-white/[0.025]">
      <p className="text-[10px] font-black uppercase tracking-widest text-[#536078] dark:text-[#B8C2E6]/65">{title}</p>
      <div className={warning ? 'mt-2 space-y-1 text-[#B93C17] dark:text-[#FFB299]' : 'mt-2 space-y-1 text-[#35405A] dark:text-[#D8E0FF]/72'}>
        {values.map((value) => (
          <p className="truncate text-xs font-bold" key={value} title={value}>
            {value}
          </p>
        ))}
      </div>
    </div>
  );
}

function quotaStateClassName(state: QuotaPolicy['enforcementState']) {
  if (state === 'disabled_by_quota') {
    return 'rounded-full bg-[#FFD8C6] px-3 py-1 text-[10px] font-bold uppercase text-[#B93C17] dark:bg-[#FF6B6B]/10 dark:text-[#FFB299]';
  }

  if (state === 'exceeded') {
    return 'rounded-full bg-[#D9FF00]/20 px-3 py-1 text-[10px] font-bold uppercase text-[#788800] dark:bg-[#E9FF6A]/10 dark:text-[#E9FF6A]';
  }

  if (state === 'reset_pending') {
    return 'rounded-full bg-[#EAF3D1] px-3 py-1 text-[10px] font-bold uppercase text-[#35405A] dark:bg-white/10 dark:text-white/70';
  }

  return 'rounded-full bg-[#DCE1FF] px-3 py-1 text-[10px] font-bold uppercase text-[#1E3AFF] dark:bg-[#6B7CFF]/15 dark:text-[#6B7CFF]';
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
    Date.parse(right.issuedAt) - Date.parse(left.issuedAt) ||
    left.id.localeCompare(right.id)
  );
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
