import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  BellRing,
  Bot,
  Copy,
  FileSearch,
  History,
  KeyRound,
  Link2,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Trash2
} from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { ConfigDrawer } from '../../components/ui/config-drawer';
import { GlassCard } from '../../components/ui/glass-card';
import { GlassToggle } from '../../components/ui/glass-toggle';
import { GlowButton } from '../../components/ui/glow-button';
import type {
  TelegramBindingChallengeCreateInput,
  TelegramBindingChallengeCreateResult,
  TelegramBindingCreateInput,
  TelegramBindingReadModel,
  TelegramBindingScopeType,
  TelegramBotMode,
  TelegramBotSettings,
  TelegramBotSettingsUpdateInput,
  TelegramNotificationDelivery,
  TelegramNotificationDeliveryStatus,
  TelegramNotificationPolicy,
  TelegramNotificationPolicyUpdateInput,
  TelegramNotificationType,
  TelegramSubscriptionFormat,
  TelegramTestNotificationInput
} from '../../domain';
import { telegramNotificationTypes, telegramSubscriptionFormats } from '../../domain';
import { formatDateTime, formatNumber } from '../shared/format';

type AsyncAction<TInput, TResult = void> = (input: TInput) => void | Promise<TResult | undefined>;

type TelegramNotificationSettingsPageProps = {
  bindings: TelegramBindingReadModel[];
  deliveries: TelegramNotificationDelivery[];
  language: AppLanguage;
  policies: TelegramNotificationPolicy[];
  settings: TelegramBotSettings;
  mutationBusy?: boolean;
  onCreateBinding?: AsyncAction<TelegramBindingCreateInput, TelegramBindingReadModel>;
  onCreateChallenge?: AsyncAction<TelegramBindingChallengeCreateInput, TelegramBindingChallengeCreateResult>;
  onRetryDelivery?: (deliveryId: string) => void | Promise<void>;
  onRevokeBinding?: (bindingId: string, reason?: string) => void | Promise<void>;
  onTestNotification?: AsyncAction<TelegramTestNotificationInput, TelegramNotificationDelivery>;
  onUpdatePolicy?: (
    policyId: string,
    input: TelegramNotificationPolicyUpdateInput
  ) => void | Promise<TelegramNotificationPolicy | undefined>;
  onUpdateSettings?: AsyncAction<TelegramBotSettingsUpdateInput, TelegramBotSettings>;
};

type SettingsDraft = {
  enabled: boolean;
  mode: TelegramBotMode;
  language: TelegramBotSettings['language'];
  botToken: string;
  clearBotToken: boolean;
  adminChatIds: string;
  adminTelegramUserIds: string;
  customApiBaseUrl: string;
  webhookPublicBaseUrl: string;
  requestTimeoutMs: string;
  sendRateLimitPerSecond: string;
  deliveryHistoryLimit: string;
  reason: string;
};

type BindingDraft = {
  telegramChatId: string;
  telegramUserId: string;
  username: string;
  displayName: string;
  customerId: string;
  customerName: string;
  scopeType: TelegramBindingScopeType;
};

type ChallengeDraft = {
  customerId: string;
  customerName: string;
  scopeType: TelegramBindingScopeType;
  expiresInSeconds: string;
};

type PolicyDraft = {
  enabled: boolean;
  language: TelegramNotificationPolicy['language'];
  notificationTypes: TelegramNotificationType[];
  allowSubscriptionLinks: boolean;
  allowedSubscriptionFormats: TelegramSubscriptionFormat[];
  subscriptionLinkPrivateChatOnly: boolean;
  trafficThresholdPercents: string;
  expiryReminderDays: string;
  maxMessagesPerHour: string;
  reason: string;
};

const copy = {
  zh: {
    title: 'Telegram 通知设置',
    subtitle: '配置 Bot、客户绑定、通知策略、测试发送与投递记录。',
    status: {
      enabled: '已启用',
      disabled: '已停用',
      tokenSet: 'Token 已配置',
      tokenMissing: 'Token 未配置',
      webhook: 'Webhook',
      long_polling: 'Long polling'
    },
    settings: 'Bot 配置',
    bindings: '客户绑定',
    newBinding: '新增绑定',
    challenge: '绑定验证码',
    policy: '默认通知策略',
    deliveries: '投递记录',
    save: '保存',
    create: '创建',
    generate: '生成',
    sendTest: '发送测试',
    retry: '重试',
    revoke: '撤销',
    confirmSaveSettings: '确认保存 Telegram Bot 配置？',
    confirmSavePolicy: '确认保存 Telegram 默认通知策略？',
    confirmSendTest: '确认发送 Telegram 测试通知？',
    confirmRetryDelivery: (deliveryId: string) => `确认重试 Telegram 投递 ${deliveryId}？`,
    confirmRetryDeliveries: (count: string) => `确认重试 ${count} 个已选 Telegram 投递？`,
    confirmRevokeBinding: (name: string) => `确认撤销 ${name} 的 Telegram 绑定？`,
    enabled: '启用',
    mode: '模式',
    language: '语言',
    botToken: 'Bot Token',
    clearToken: '清除 Token',
    adminChatIds: '管理员 Chat ID',
    adminUserIds: '管理员 User ID',
    customApiBaseUrl: '自定义 API 地址',
    webhookPublicBaseUrl: 'Webhook 公网地址',
    timeout: '请求超时 ms',
    rateLimit: '每秒发送上限',
    historyLimit: '历史记录上限',
    reason: '变更原因',
    chatId: 'Chat ID',
    userId: 'User ID',
    username: '用户名',
    displayName: '显示名',
    customerId: '客户 ID',
    customerName: '客户名',
    scope: '范围',
    expires: '有效秒数',
    latestCode: '最新验证码',
    owner: '对象',
    notifications: '通知类型',
    formats: '订阅格式',
    allowLinks: '允许订阅链接',
    privateOnly: '仅私聊发送链接',
    thresholds: '流量阈值 %',
    expiryDays: '到期提醒天数',
    maxPerHour: '每小时上限',
    emptyBindings: '暂无 Telegram 绑定。',
    emptyDeliveries: '暂无投递记录。',
    lastDelivery: '最近投递',
    attempts: '尝试',
    updatedAt: '更新',
    target: '目标',
    statusLabel: '状态',
    searchDeliveries: '搜索投递记录',
    searchDeliveriesPlaceholder: '搜索类型、目标、错误、模板、载荷哈希或预览',
    deliveryStatus: '投递状态',
    allDeliveryStatuses: '全部状态',
    matchingDeliveries: '当前匹配',
    noMatchingDeliveries: '没有匹配的投递记录。',
    selectDelivery: '选择投递',
    selectVisibleDeliveries: '选择当前投递',
    selectedDeliveries: '已选投递',
    bulkRetryDeliveries: '批量重试投递',
    deliveryRetryPreflight: '投递重试预检',
    deliveryRetryHint: '批量重试会重新触发 Telegram 发送；执行前请核对目标、通知类型、错误原因和死信状态，避免重复通知。',
    deliveryRetryFailed: '失败/死信',
    deliveryRetryTargets: 'Telegram 目标',
    deliveryRetryTypes: '通知类型',
    deliveryRetryErrors: '错误来源',
    deliveryRetryDeliveryPreview: '投递预览',
    deliveryRetryTargetPreview: '目标预览',
    deliveryRetryErrorPreview: '错误预览',
    deliveryRetryNoError: '暂无错误记录',
    viewEvidence: '查看投递证据',
    evidenceTitle: '投递证据',
    evidenceDescription: '查看投递目标、错误、重试时间、载荷哈希和脱敏预览。',
    deliverySummary: '投递摘要',
    deliveryContext: '上下文',
    deliveryTarget: '目标',
    deliveryError: '错误',
    deliveryPreview: '脱敏预览',
    deliveryPayload: '载荷哈希',
    copyEvidence: '复制投递证据',
    id: 'ID',
    type: '类型',
    recipient: '接收方',
    policyId: '策略',
    templateId: '模板',
    payloadHash: 'Payload Hash',
    dedupeKey: '去重键',
    nextAttemptAt: '下次重试',
    lastAttemptAt: '上次尝试',
    createdAt: '创建',
    deliveredAt: '已投递',
    deadLetteredAt: '死信时间',
    noEvidence: '暂无额外证据'
  },
  en: {
    title: 'Telegram Notification Settings',
    subtitle: 'Configure the bot, customer bindings, notification policy, test delivery, and delivery history.',
    status: {
      enabled: 'Enabled',
      disabled: 'Disabled',
      tokenSet: 'Token Set',
      tokenMissing: 'Token Missing',
      webhook: 'Webhook',
      long_polling: 'Long polling'
    },
    settings: 'Bot Settings',
    bindings: 'Customer Bindings',
    newBinding: 'New Binding',
    challenge: 'Binding Challenge',
    policy: 'Default Notification Policy',
    deliveries: 'Delivery History',
    save: 'Save',
    create: 'Create',
    generate: 'Generate',
    sendTest: 'Send Test',
    retry: 'Retry',
    revoke: 'Revoke',
    confirmSaveSettings: 'Save Telegram Bot settings?',
    confirmSavePolicy: 'Save Telegram default notification policy?',
    confirmSendTest: 'Send Telegram test notification?',
    confirmRetryDelivery: (deliveryId: string) => `Retry Telegram delivery ${deliveryId}?`,
    confirmRetryDeliveries: (count: string) =>
      `Retry ${count} selected Telegram ${count === '1' ? 'delivery' : 'deliveries'}?`,
    confirmRevokeBinding: (name: string) => `Revoke Telegram binding for ${name}?`,
    enabled: 'Enabled',
    mode: 'Mode',
    language: 'Language',
    botToken: 'Bot Token',
    clearToken: 'Clear Token',
    adminChatIds: 'Admin Chat IDs',
    adminUserIds: 'Admin User IDs',
    customApiBaseUrl: 'Custom API Base URL',
    webhookPublicBaseUrl: 'Webhook Public Base URL',
    timeout: 'Request Timeout ms',
    rateLimit: 'Send Rate / second',
    historyLimit: 'History Limit',
    reason: 'Change Reason',
    chatId: 'Chat ID',
    userId: 'User ID',
    username: 'Username',
    displayName: 'Display Name',
    customerId: 'Customer ID',
    customerName: 'Customer Name',
    scope: 'Scope',
    expires: 'Expires seconds',
    latestCode: 'Latest Code',
    owner: 'Owner',
    notifications: 'Notification Types',
    formats: 'Subscription Formats',
    allowLinks: 'Allow Subscription Links',
    privateOnly: 'Private Chat Links Only',
    thresholds: 'Traffic Thresholds %',
    expiryDays: 'Expiry Reminder Days',
    maxPerHour: 'Max / hour',
    emptyBindings: 'No Telegram bindings yet.',
    emptyDeliveries: 'No deliveries yet.',
    lastDelivery: 'Last Delivery',
    attempts: 'Attempts',
    updatedAt: 'Updated',
    target: 'Target',
    statusLabel: 'Status',
    searchDeliveries: 'Search Deliveries',
    searchDeliveriesPlaceholder: 'Search type, target, error, template, payload hash, or preview',
    deliveryStatus: 'Delivery Status',
    allDeliveryStatuses: 'All statuses',
    matchingDeliveries: 'Matching',
    noMatchingDeliveries: 'No matching delivery records.',
    selectDelivery: 'Select Delivery',
    selectVisibleDeliveries: 'Select Visible Deliveries',
    selectedDeliveries: 'Selected Deliveries',
    bulkRetryDeliveries: 'Bulk Retry Deliveries',
    deliveryRetryPreflight: 'Delivery Retry Preflight',
    deliveryRetryHint:
      'Bulk retry will re-trigger Telegram sends. Review selected targets, notification types, delivery state, and errors before execution.',
    deliveryRetryFailed: 'Failed/Dead-letter',
    deliveryRetryTargets: 'Telegram Targets',
    deliveryRetryTypes: 'Notification Types',
    deliveryRetryErrors: 'Error Sources',
    deliveryRetryDeliveryPreview: 'Delivery Preview',
    deliveryRetryTargetPreview: 'Target Preview',
    deliveryRetryErrorPreview: 'Error Preview',
    deliveryRetryNoError: 'No delivery errors recorded',
    viewEvidence: 'View Delivery Evidence',
    evidenceTitle: 'Delivery Evidence',
    evidenceDescription: 'Inspect delivery target, error, retry timing, payload hash, and redacted preview.',
    deliverySummary: 'Delivery Summary',
    deliveryContext: 'Context',
    deliveryTarget: 'Target',
    deliveryError: 'Error',
    deliveryPreview: 'Redacted Preview',
    deliveryPayload: 'Payload Hash',
    copyEvidence: 'Copy Delivery Evidence',
    id: 'ID',
    type: 'Type',
    recipient: 'Recipient',
    policyId: 'Policy',
    templateId: 'Template',
    payloadHash: 'Payload Hash',
    dedupeKey: 'Dedupe Key',
    nextAttemptAt: 'Next Attempt',
    lastAttemptAt: 'Last Attempt',
    createdAt: 'Created',
    deliveredAt: 'Delivered',
    deadLetteredAt: 'Dead Lettered',
    noEvidence: 'No additional evidence'
  }
} as const;

type TelegramCopy = (typeof copy)[AppLanguage];

const scopeOptions: TelegramBindingScopeType[] = [
  'customer',
  'subscription-user',
  'xray-client',
  'forwarding-owner',
  'forwarding-rule'
];
const deliveryStatuses: TelegramNotificationDeliveryStatus[] = [
  'pending',
  'failed',
  'delivered',
  'dead_letter',
  'suppressed'
];

type DeliveryStatusFilter = 'all' | TelegramNotificationDeliveryStatus;

type DeliveryRetryPreflightSummary = {
  deliveryLabels: string[];
  targetLabels: string[];
  typeLabels: string[];
  errorLabels: string[];
  failedOrDeadLetterCount: number;
};

function settingsToDraft(settings: TelegramBotSettings): SettingsDraft {
  return {
    enabled: settings.enabled,
    mode: settings.mode,
    language: settings.language,
    botToken: '',
    clearBotToken: false,
    adminChatIds: settings.adminChatIds.join('\n'),
    adminTelegramUserIds: settings.adminTelegramUserIds.join('\n'),
    customApiBaseUrl: settings.customApiBaseUrl ?? '',
    webhookPublicBaseUrl: settings.webhookPublicBaseUrl ?? '',
    requestTimeoutMs: String(settings.requestTimeoutMs),
    sendRateLimitPerSecond: String(settings.sendRateLimitPerSecond),
    deliveryHistoryLimit: String(settings.deliveryHistoryLimit),
    reason: ''
  };
}

function policyToDraft(policy: TelegramNotificationPolicy | undefined, settings: TelegramBotSettings): PolicyDraft {
  return {
    enabled: policy?.enabled ?? true,
    language: policy?.language ?? settings.language,
    notificationTypes: policy?.notificationTypes ?? [...telegramNotificationTypes],
    allowSubscriptionLinks: policy?.allowSubscriptionLinks ?? false,
    allowedSubscriptionFormats: policy?.allowedSubscriptionFormats ?? ['clash', 'mihomo', 'sing-box', 'uri'],
    subscriptionLinkPrivateChatOnly: policy?.subscriptionLinkPrivateChatOnly ?? true,
    trafficThresholdPercents: (policy?.trafficThresholdPercents ?? [50, 80, 90, 100]).join(', '),
    expiryReminderDays: (policy?.expiryReminderDays ?? [7, 3, 1]).join(', '),
    maxMessagesPerHour: String(policy?.maxMessagesPerHour ?? 12),
    reason: ''
  };
}

function splitList(value: string) {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumberList(value: string) {
  return splitList(value)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

function readPositiveInteger(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function toggleValue<T extends string>(values: T[], value: T) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function normalizeDeliverySearch(value: string) {
  return value.trim().toLowerCase();
}

function stringifyDeliveryEvidence(value: unknown) {
  if (value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function compactDeliverySearchText(...values: unknown[]) {
  return values
    .map((value) => stringifyDeliveryEvidence(value))
    .filter(Boolean)
    .join(' ');
}

function readDeliveryRecipient(delivery: TelegramNotificationDelivery) {
  return delivery.customerBindingId ?? delivery.chatBindingId ?? delivery.adminChatId ?? delivery.id;
}

function createDeliverySearchText(delivery: TelegramNotificationDelivery) {
  return compactDeliverySearchText(
    delivery.id,
    delivery.dedupeKey,
    delivery.notificationType,
    delivery.recipientKind,
    readDeliveryRecipient(delivery),
    delivery.policyId,
    delivery.templateId,
    delivery.language,
    delivery.status,
    delivery.lastErrorMessage,
    delivery.renderedPreviewRedacted,
    delivery.payloadHash,
    delivery.target
  ).toLowerCase();
}

function filterDeliveries(deliveries: TelegramNotificationDelivery[], query: string, statusFilter: DeliveryStatusFilter) {
  const normalizedQuery = normalizeDeliverySearch(query);

  return deliveries.filter((delivery) => {
    const matchesStatus = statusFilter === 'all' || delivery.status === statusFilter;
    const matchesQuery = !normalizedQuery || createDeliverySearchText(delivery).includes(normalizedQuery);

    return matchesStatus && matchesQuery;
  });
}

function createDeliveryRetryPreflightSummary(
  deliveries: TelegramNotificationDelivery[]
): DeliveryRetryPreflightSummary {
  const targetLabels = new Set<string>();
  const typeLabels = new Set<string>();
  const errorLabels = new Set<string>();
  let failedOrDeadLetterCount = 0;

  const deliveryLabels = deliveries.map((delivery) => {
    targetLabels.add(`${delivery.recipientKind} · ${readDeliveryRecipient(delivery)}`);
    typeLabels.add(delivery.notificationType);

    if (delivery.status === 'failed' || delivery.status === 'dead_letter') {
      failedOrDeadLetterCount += 1;
    }

    const error = delivery.lastErrorMessage?.trim();
    if (error) {
      errorLabels.add(error);
    }

    return `${delivery.id} · ${delivery.notificationType} · ${delivery.status} · ${delivery.attemptCount}/${delivery.maxAttempts}`;
  });

  return {
    deliveryLabels,
    targetLabels: Array.from(targetLabels).sort((left, right) => left.localeCompare(right)),
    typeLabels: Array.from(typeLabels).sort((left, right) => left.localeCompare(right)),
    errorLabels: Array.from(errorLabels).sort((left, right) => left.localeCompare(right)),
    failedOrDeadLetterCount
  };
}

function createDeliveryEvidenceText(delivery: TelegramNotificationDelivery) {
  return JSON.stringify(delivery, null, 2);
}

function copyDeliveryEvidence(delivery: TelegramNotificationDelivery) {
  void navigator.clipboard?.writeText(createDeliveryEvidenceText(delivery));
}

function readDeliveryStatusTone(status: TelegramNotificationDeliveryStatus): 'blue' | 'green' | 'red' | 'slate' {
  if (status === 'delivered') {
    return 'green';
  }

  if (status === 'failed' || status === 'dead_letter') {
    return 'red';
  }

  if (status === 'suppressed') {
    return 'slate';
  }

  return 'blue';
}

export function TelegramNotificationSettingsPage({
  bindings,
  deliveries,
  language,
  mutationBusy = false,
  policies,
  settings,
  onCreateBinding,
  onCreateChallenge,
  onRetryDelivery,
  onRevokeBinding,
  onTestNotification,
  onUpdatePolicy,
  onUpdateSettings
}: TelegramNotificationSettingsPageProps) {
  const t = copy[language];
  const defaultPolicy = useMemo(
    () => policies.find((policy) => policy.id === settings.defaultPolicyId) ?? policies[0],
    [policies, settings.defaultPolicyId]
  );
  const [settingsDraft, setSettingsDraft] = useState(() => settingsToDraft(settings));
  const [bindingDraft, setBindingDraft] = useState<BindingDraft>({
    telegramChatId: '',
    telegramUserId: '',
    username: '',
    displayName: '',
    customerId: '',
    customerName: '',
    scopeType: 'customer'
  });
  const [challengeDraft, setChallengeDraft] = useState<ChallengeDraft>({
    customerId: '',
    customerName: '',
    scopeType: 'customer',
    expiresInSeconds: '600'
  });
  const [policyDraft, setPolicyDraft] = useState(() => policyToDraft(defaultPolicy, settings));
  const [selectedBindingId, setSelectedBindingId] = useState(bindings[0]?.id ?? '');
  const [lastChallenge, setLastChallenge] = useState<TelegramBindingChallengeCreateResult | undefined>();
  const [deliverySearch, setDeliverySearch] = useState('');
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState<DeliveryStatusFilter>('all');
  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState<string[]>([]);
  const [selectedDelivery, setSelectedDelivery] = useState<TelegramNotificationDelivery | undefined>();
  const filteredDeliveries = useMemo(
    () => filterDeliveries(deliveries, deliverySearch, deliveryStatusFilter),
    [deliveries, deliverySearch, deliveryStatusFilter]
  );
  const selectedDeliveries = useMemo(
    () => deliveries.filter((delivery) => selectedDeliveryIds.includes(delivery.id)),
    [deliveries, selectedDeliveryIds]
  );
  const selectedVisibleDeliveryCount = useMemo(
    () => filteredDeliveries.filter((delivery) => selectedDeliveryIds.includes(delivery.id)).length,
    [filteredDeliveries, selectedDeliveryIds]
  );
  const deliveryRetryPreflightSummary = useMemo(
    () => createDeliveryRetryPreflightSummary(selectedDeliveries),
    [selectedDeliveries]
  );

  useEffect(() => {
    setSettingsDraft(settingsToDraft(settings));
  }, [settings]);

  useEffect(() => {
    setPolicyDraft(policyToDraft(defaultPolicy, settings));
  }, [defaultPolicy, settings]);

  useEffect(() => {
    if (!bindings.some((binding) => binding.id === selectedBindingId)) {
      setSelectedBindingId(bindings[0]?.id ?? '');
    }
  }, [bindings, selectedBindingId]);

  useEffect(() => {
    const deliveryIds = new Set(deliveries.map((delivery) => delivery.id));

    setSelectedDeliveryIds((current) => current.filter((id) => deliveryIds.has(id)));
  }, [deliveries]);

  async function submitSettings(event: FormEvent) {
    event.preventDefault();
    const confirmed = typeof window === 'undefined' || window.confirm(t.confirmSaveSettings);

    if (!confirmed) {
      return;
    }

    const updated = await onUpdateSettings?.({
      enabled: settingsDraft.enabled,
      mode: settingsDraft.mode,
      language: settingsDraft.language,
      ...(settingsDraft.botToken.trim() ? { botToken: settingsDraft.botToken.trim() } : {}),
      ...(settingsDraft.clearBotToken ? { clearBotToken: true } : {}),
      adminChatIds: splitList(settingsDraft.adminChatIds),
      adminTelegramUserIds: splitList(settingsDraft.adminTelegramUserIds),
      customApiBaseUrl: settingsDraft.customApiBaseUrl.trim() || undefined,
      webhookPublicBaseUrl: settingsDraft.webhookPublicBaseUrl.trim() || undefined,
      requestTimeoutMs: readPositiveInteger(settingsDraft.requestTimeoutMs, settings.requestTimeoutMs),
      sendRateLimitPerSecond: readPositiveInteger(
        settingsDraft.sendRateLimitPerSecond,
        settings.sendRateLimitPerSecond
      ),
      deliveryHistoryLimit: readPositiveInteger(settingsDraft.deliveryHistoryLimit, settings.deliveryHistoryLimit),
      reason: settingsDraft.reason.trim() || undefined
    });

    setSettingsDraft(settingsToDraft(updated ?? settings));
  }

  async function submitBinding(event: FormEvent) {
    event.preventDefault();
    const created = await onCreateBinding?.({
      telegramChatId: bindingDraft.telegramChatId.trim(),
      telegramUserId: bindingDraft.telegramUserId.trim() || undefined,
      username: bindingDraft.username.trim() || undefined,
      displayName: bindingDraft.displayName.trim() || undefined,
      customerId: bindingDraft.customerId.trim(),
      customerName: bindingDraft.customerName.trim() || undefined,
      scopeType: bindingDraft.scopeType
    });

    if (created) {
      setSelectedBindingId(created.id);
    }

    setBindingDraft((current) => ({
      ...current,
      telegramChatId: '',
      telegramUserId: '',
      username: '',
      displayName: ''
    }));
  }

  async function submitChallenge(event: FormEvent) {
    event.preventDefault();
    const result = await onCreateChallenge?.({
      customerId: challengeDraft.customerId.trim(),
      customerName: challengeDraft.customerName.trim() || undefined,
      scopeType: challengeDraft.scopeType,
      expiresInSeconds: readPositiveInteger(challengeDraft.expiresInSeconds, 600)
    });

    if (result) {
      setLastChallenge(result);
    }
  }

  async function submitPolicy(event: FormEvent) {
    event.preventDefault();

    if (!defaultPolicy) {
      return;
    }

    const confirmed = typeof window === 'undefined' || window.confirm(t.confirmSavePolicy);

    if (!confirmed) {
      return;
    }

    const updated = await onUpdatePolicy?.(defaultPolicy.id, {
      enabled: policyDraft.enabled,
      language: policyDraft.language,
      notificationTypes: policyDraft.notificationTypes,
      allowSubscriptionLinks: policyDraft.allowSubscriptionLinks,
      allowedSubscriptionFormats: policyDraft.allowedSubscriptionFormats,
      subscriptionLinkPrivateChatOnly: policyDraft.subscriptionLinkPrivateChatOnly,
      trafficThresholdPercents: parseNumberList(policyDraft.trafficThresholdPercents),
      expiryReminderDays: parseNumberList(policyDraft.expiryReminderDays),
      maxMessagesPerHour: readPositiveInteger(policyDraft.maxMessagesPerHour, defaultPolicy.maxMessagesPerHour),
      reason: policyDraft.reason.trim() || undefined
    });

    setPolicyDraft(policyToDraft(updated ?? defaultPolicy, settings));
  }

  async function sendTestToSelectedBinding() {
    if (!selectedBindingId) {
      return;
    }

    const confirmed = typeof window === 'undefined' || window.confirm(t.confirmSendTest);

    if (!confirmed) {
      return;
    }

    await onTestNotification?.({
      target: {
        kind: 'binding',
        bindingId: selectedBindingId
      },
      language: settings.language
    });
  }

  function toggleDeliverySelection(deliveryId: string) {
    setSelectedDeliveryIds((current) =>
      current.includes(deliveryId) ? current.filter((id) => id !== deliveryId) : [...current, deliveryId]
    );
  }

  function toggleVisibleDeliverySelection() {
    const visibleIds = filteredDeliveries.map((delivery) => delivery.id);

    if (visibleIds.length === 0) {
      return;
    }

    setSelectedDeliveryIds((current) => {
      const visibleIdSet = new Set(visibleIds);
      const allVisibleSelected = visibleIds.every((id) => current.includes(id));

      return allVisibleSelected
        ? current.filter((id) => !visibleIdSet.has(id))
        : Array.from(new Set([...current, ...visibleIds]));
    });
  }

  function retrySelectedDeliveries() {
    retryDeliveries(selectedDeliveries);
  }

  function retryDelivery(delivery: TelegramNotificationDelivery) {
    const confirmed = typeof window === 'undefined' || window.confirm(t.confirmRetryDelivery(delivery.id));

    if (!confirmed) {
      return;
    }

    void onRetryDelivery?.(delivery.id);
  }

  function retryDeliveries(deliveriesToRetry: TelegramNotificationDelivery[]) {
    const uniqueDeliveries = Array.from(new Map(deliveriesToRetry.map((delivery) => [delivery.id, delivery])).values());

    if (uniqueDeliveries.length === 0) {
      return;
    }

    const confirmed =
      typeof window === 'undefined' || window.confirm(t.confirmRetryDeliveries(String(uniqueDeliveries.length)));

    if (!confirmed) {
      return;
    }

    uniqueDeliveries.forEach((delivery) => {
      void onRetryDelivery?.(delivery.id);
    });
  }

  function revokeBinding(binding: TelegramBindingReadModel) {
    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(t.confirmRevokeBinding(binding.customerBinding.customerNameSnapshot));

    if (confirmed) {
      void onRevokeBinding?.(binding.id, 'operator requested revoke');
    }
  }

  return (
    <div className="space-y-6">
      <section className="stagger-1">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-white/50">{t.subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill value={settings.enabled ? t.status.enabled : t.status.disabled} tone={settings.enabled ? 'green' : 'slate'} />
            <StatusPill value={settings.botTokenSet ? t.status.tokenSet : t.status.tokenMissing} tone={settings.botTokenSet ? 'green' : 'red'} />
            <StatusPill value={settings.mode === 'webhook' ? t.status.webhook : t.status.long_polling} tone="blue" />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <GlassCard className="stagger-2 p-5">
          <SectionTitle icon={Bot} title={t.settings} />
          <form className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={submitSettings}>
            <ToggleField
              checked={settingsDraft.enabled}
              label={t.enabled}
              onChange={(checked) => setSettingsDraft((draft) => ({ ...draft, enabled: checked }))}
            />
            <ToggleField
              checked={settingsDraft.clearBotToken}
              label={t.clearToken}
              onChange={(checked) => setSettingsDraft((draft) => ({ ...draft, clearBotToken: checked }))}
            />
            <SelectField
              label={t.mode}
              onChange={(value) => setSettingsDraft((draft) => ({ ...draft, mode: value as TelegramBotMode }))}
              value={settingsDraft.mode}
            >
              <option value="long_polling">long_polling</option>
              <option value="webhook">webhook</option>
            </SelectField>
            <SelectField
              label={t.language}
              onChange={(value) =>
                setSettingsDraft((draft) => ({ ...draft, language: value as TelegramBotSettings['language'] }))
              }
              value={settingsDraft.language}
            >
              <option value="zh-CN">zh-CN</option>
              <option value="en">en</option>
            </SelectField>
            <TextField
              label={t.botToken}
              onChange={(value) => setSettingsDraft((draft) => ({ ...draft, botToken: value }))}
              type="password"
              value={settingsDraft.botToken}
            />
            <TextField
              label={t.customApiBaseUrl}
              onChange={(value) => setSettingsDraft((draft) => ({ ...draft, customApiBaseUrl: value }))}
              value={settingsDraft.customApiBaseUrl}
            />
            <TextAreaField
              label={t.adminChatIds}
              onChange={(value) => setSettingsDraft((draft) => ({ ...draft, adminChatIds: value }))}
              value={settingsDraft.adminChatIds}
            />
            <TextAreaField
              label={t.adminUserIds}
              onChange={(value) => setSettingsDraft((draft) => ({ ...draft, adminTelegramUserIds: value }))}
              value={settingsDraft.adminTelegramUserIds}
            />
            <TextField
              label={t.webhookPublicBaseUrl}
              onChange={(value) => setSettingsDraft((draft) => ({ ...draft, webhookPublicBaseUrl: value }))}
              value={settingsDraft.webhookPublicBaseUrl}
            />
            <TextField
              label={t.timeout}
              onChange={(value) => setSettingsDraft((draft) => ({ ...draft, requestTimeoutMs: value }))}
              type="number"
              value={settingsDraft.requestTimeoutMs}
            />
            <TextField
              label={t.rateLimit}
              onChange={(value) => setSettingsDraft((draft) => ({ ...draft, sendRateLimitPerSecond: value }))}
              type="number"
              value={settingsDraft.sendRateLimitPerSecond}
            />
            <TextField
              label={t.historyLimit}
              onChange={(value) => setSettingsDraft((draft) => ({ ...draft, deliveryHistoryLimit: value }))}
              type="number"
              value={settingsDraft.deliveryHistoryLimit}
            />
            <TextField
              className="md:col-span-2"
              label={t.reason}
              onChange={(value) => setSettingsDraft((draft) => ({ ...draft, reason: value }))}
              value={settingsDraft.reason}
            />
            <div className="md:col-span-2">
              <GlowButton className="inline-flex items-center gap-2 px-4 py-2 text-xs" disabled={mutationBusy} type="submit">
                <Save className="h-4 w-4" />
                {t.save}
              </GlowButton>
            </div>
          </form>
        </GlassCard>

        <GlassCard className="stagger-2 p-5">
          <SectionTitle icon={KeyRound} title={t.challenge} />
          <form className="mt-5 space-y-4" onSubmit={submitChallenge}>
            <TextField
              label={t.customerId}
              onChange={(value) => setChallengeDraft((draft) => ({ ...draft, customerId: value }))}
              required
              value={challengeDraft.customerId}
            />
            <TextField
              label={t.customerName}
              onChange={(value) => setChallengeDraft((draft) => ({ ...draft, customerName: value }))}
              value={challengeDraft.customerName}
            />
            <SelectField
              label={t.scope}
              onChange={(value) =>
                setChallengeDraft((draft) => ({ ...draft, scopeType: value as TelegramBindingScopeType }))
              }
              value={challengeDraft.scopeType}
            >
              {scopeOptions.map((scope) => (
                <option key={scope} value={scope}>{scope}</option>
              ))}
            </SelectField>
            <TextField
              label={t.expires}
              onChange={(value) => setChallengeDraft((draft) => ({ ...draft, expiresInSeconds: value }))}
              type="number"
              value={challengeDraft.expiresInSeconds}
            />
            <GlowButton className="inline-flex items-center gap-2 px-4 py-2 text-xs" disabled={mutationBusy} type="submit">
              <Plus className="h-4 w-4" />
              {t.generate}
            </GlowButton>
          </form>
          {lastChallenge ? (
            <div className="mt-5 rounded-lg border border-slate-200 p-4 dark:border-white/10">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                {t.latestCode}
              </p>
              <p className="mt-2 font-mono text-lg font-bold text-slate-900 dark:text-white">{lastChallenge.code}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-white/50">
                {formatDateTime(lastChallenge.challenge.expiresAt, language)}
              </p>
            </div>
          ) : null}
        </GlassCard>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(360px,0.8fr)_minmax(0,1.2fr)]">
        <GlassCard className="stagger-3 p-5">
          <SectionTitle icon={Link2} title={t.newBinding} />
          <form className="mt-5 space-y-4" onSubmit={submitBinding}>
            <TextField label={t.chatId} onChange={(value) => setBindingDraft((draft) => ({ ...draft, telegramChatId: value }))} required value={bindingDraft.telegramChatId} />
            <TextField label={t.userId} onChange={(value) => setBindingDraft((draft) => ({ ...draft, telegramUserId: value }))} value={bindingDraft.telegramUserId} />
            <TextField label={t.username} onChange={(value) => setBindingDraft((draft) => ({ ...draft, username: value }))} value={bindingDraft.username} />
            <TextField label={t.displayName} onChange={(value) => setBindingDraft((draft) => ({ ...draft, displayName: value }))} value={bindingDraft.displayName} />
            <TextField label={t.customerId} onChange={(value) => setBindingDraft((draft) => ({ ...draft, customerId: value }))} required value={bindingDraft.customerId} />
            <TextField label={t.customerName} onChange={(value) => setBindingDraft((draft) => ({ ...draft, customerName: value }))} value={bindingDraft.customerName} />
            <SelectField label={t.scope} onChange={(value) => setBindingDraft((draft) => ({ ...draft, scopeType: value as TelegramBindingScopeType }))} value={bindingDraft.scopeType}>
              {scopeOptions.map((scope) => (
                <option key={scope} value={scope}>{scope}</option>
              ))}
            </SelectField>
            <GlowButton className="inline-flex items-center gap-2 px-4 py-2 text-xs" disabled={mutationBusy} type="submit">
              <Plus className="h-4 w-4" />
              {t.create}
            </GlowButton>
          </form>
        </GlassCard>

        <GlassCard className="stagger-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionTitle icon={ShieldCheck} title={t.bindings} />
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label={t.target}
                className="glass-select-control min-w-[220px] rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-xs font-bold text-slate-800 outline-none dark:border-white/10 dark:bg-black/20 dark:text-white"
                onChange={(event) => setSelectedBindingId(event.target.value)}
                value={selectedBindingId}
              >
                {bindings.map((binding) => (
                  <option key={binding.id} value={binding.id}>
                    {binding.customerBinding.customerNameSnapshot}
                  </option>
                ))}
              </select>
              <GlowButton className="inline-flex items-center gap-2 px-3 py-2 text-xs" disabled={mutationBusy || !selectedBindingId} onClick={sendTestToSelectedBinding}>
                <Send className="h-4 w-4" />
                {t.sendTest}
              </GlowButton>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {bindings.map((binding) => (
              <div key={binding.id} className="rounded-lg border border-slate-200 p-4 dark:border-white/10">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">
                      {binding.customerBinding.customerNameSnapshot}
                    </p>
                    <p className="mt-1 break-all font-mono text-[11px] text-slate-500 dark:text-white/45">
                      {binding.chat.displayName ?? binding.chat.username ?? binding.chat.telegramChatId} · {binding.customerBinding.scopeType}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill value={binding.customerBinding.status} tone={binding.customerBinding.status === 'active' ? 'green' : 'slate'} />
                    <button
                      aria-label={`${t.revoke} ${binding.customerBinding.customerNameSnapshot}`}
                      className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:text-red-600 dark:border-white/10 dark:text-white/60"
                      disabled={mutationBusy}
                      onClick={() => revokeBinding(binding)}
                      type="button"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <Meta label={t.lastDelivery} value={binding.lastDelivery?.status ?? '-'} />
                  <Meta label={t.policy} value={binding.policy?.id ?? settings.defaultPolicyId} />
                  <Meta label={t.updatedAt} value={formatDateTime(binding.chat.updatedAt, language)} />
                </div>
              </div>
            ))}
            {bindings.length === 0 ? <EmptyState text={t.emptyBindings} /> : null}
          </div>
        </GlassCard>
      </section>

      <GlassCard className="stagger-4 p-5">
        <SectionTitle icon={BellRing} title={t.policy} />
        <form className="mt-5 space-y-5" onSubmit={submitPolicy}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <ToggleField checked={policyDraft.enabled} label={t.enabled} onChange={(checked) => setPolicyDraft((draft) => ({ ...draft, enabled: checked }))} />
            <ToggleField checked={policyDraft.allowSubscriptionLinks} label={t.allowLinks} onChange={(checked) => setPolicyDraft((draft) => ({ ...draft, allowSubscriptionLinks: checked }))} />
            <ToggleField checked={policyDraft.subscriptionLinkPrivateChatOnly} label={t.privateOnly} onChange={(checked) => setPolicyDraft((draft) => ({ ...draft, subscriptionLinkPrivateChatOnly: checked }))} />
            <SelectField label={t.language} onChange={(value) => setPolicyDraft((draft) => ({ ...draft, language: value as TelegramNotificationPolicy['language'] }))} value={policyDraft.language}>
              <option value="zh-CN">zh-CN</option>
              <option value="en">en</option>
            </SelectField>
            <TextField label={t.thresholds} onChange={(value) => setPolicyDraft((draft) => ({ ...draft, trafficThresholdPercents: value }))} value={policyDraft.trafficThresholdPercents} />
            <TextField label={t.expiryDays} onChange={(value) => setPolicyDraft((draft) => ({ ...draft, expiryReminderDays: value }))} value={policyDraft.expiryReminderDays} />
            <TextField label={t.maxPerHour} onChange={(value) => setPolicyDraft((draft) => ({ ...draft, maxMessagesPerHour: value }))} type="number" value={policyDraft.maxMessagesPerHour} />
            <TextField className="md:col-span-2" label={t.reason} onChange={(value) => setPolicyDraft((draft) => ({ ...draft, reason: value }))} value={policyDraft.reason} />
          </div>
          <ChoiceGrid
            label={t.notifications}
            options={telegramNotificationTypes}
            selected={policyDraft.notificationTypes}
            onToggle={(value) =>
              setPolicyDraft((draft) => ({
                ...draft,
                notificationTypes: toggleValue(draft.notificationTypes, value as TelegramNotificationType)
              }))
            }
          />
          <ChoiceGrid
            label={t.formats}
            options={telegramSubscriptionFormats}
            selected={policyDraft.allowedSubscriptionFormats}
            onToggle={(value) =>
              setPolicyDraft((draft) => ({
                ...draft,
                allowedSubscriptionFormats: toggleValue(
                  draft.allowedSubscriptionFormats,
                  value as TelegramSubscriptionFormat
                )
              }))
            }
          />
          <GlowButton className="inline-flex items-center gap-2 px-4 py-2 text-xs" disabled={mutationBusy || !defaultPolicy} type="submit">
            <Save className="h-4 w-4" />
            {t.save}
          </GlowButton>
        </form>
      </GlassCard>

      <GlassCard className="stagger-4 p-5">
        <SectionTitle icon={History} title={t.deliveries} />
        {deliveries.length > 0 ? (
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(16rem,1fr)_minmax(10rem,0.32fr)]">
              <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                  {t.searchDeliveries}
                </span>
                <div className="mt-1 flex min-h-7 items-center gap-2">
                  <Search className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-white/35" />
                  <input
                    aria-label={t.searchDeliveries}
                    className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-white/35"
                    onChange={(event) => setDeliverySearch(event.target.value)}
                    placeholder={t.searchDeliveriesPlaceholder}
                    type="search"
                    value={deliverySearch}
                  />
                </div>
              </label>
              <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                  {t.deliveryStatus}
                </span>
                <select
                  aria-label={t.deliveryStatus}
                  className="glass-select-control mt-1 min-h-7 w-full bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-white"
                  onChange={(event) => setDeliveryStatusFilter(event.target.value as DeliveryStatusFilter)}
                  value={deliveryStatusFilter}
                >
                  <option value="all">{t.allDeliveryStatuses}</option>
                  {deliveryStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                {t.matchingDeliveries} {filteredDeliveries.length} / {deliveries.length}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-white/60">
                  <input
                    aria-label={t.selectVisibleDeliveries}
                    checked={filteredDeliveries.length > 0 && selectedVisibleDeliveryCount === filteredDeliveries.length}
                    className="h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                    disabled={filteredDeliveries.length === 0}
                    onChange={toggleVisibleDeliverySelection}
                    type="checkbox"
                  />
                  {t.selectVisibleDeliveries}
                </label>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-600 dark:bg-primary/15 dark:text-primary">
                  {t.selectedDeliveries} {selectedDeliveries.length}
                </span>
                <button
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 transition hover:bg-slate-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-primary"
                  disabled={selectedDeliveries.length === 0 || mutationBusy}
                  onClick={retrySelectedDeliveries}
                  type="button"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t.bulkRetryDeliveries}
                </button>
              </div>
            </div>
            {selectedDeliveries.length > 0 ? (
              <DeliveryRetryPreflight
                language={language}
                selectedCount={selectedDeliveries.length}
                summary={deliveryRetryPreflightSummary}
                t={t}
              />
            ) : null}
          </div>
        ) : null}
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="border-b border-slate-200 text-[10px] uppercase tracking-widest text-slate-500 dark:border-white/10 dark:text-white/40">
              <tr>
                <th className="px-3 py-2">{t.selectDelivery}</th>
                <th className="px-3 py-2">{t.target}</th>
                <th className="px-3 py-2">{t.statusLabel}</th>
                <th className="px-3 py-2">{t.attempts}</th>
                <th className="px-3 py-2">{t.updatedAt}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filteredDeliveries.map((delivery) => (
                <tr key={delivery.id} className="border-b border-slate-100 dark:border-white/5">
                  <td className="px-3 py-3">
                    <input
                      aria-label={`${t.selectDelivery} ${delivery.id}`}
                      checked={selectedDeliveryIds.includes(delivery.id)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-500 focus:ring-blue-400"
                      onChange={() => toggleDeliverySelection(delivery.id)}
                      type="checkbox"
                    />
                  </td>
                  <td className="max-w-[280px] px-3 py-3">
                    <p className="font-bold text-slate-800 dark:text-white">{delivery.notificationType}</p>
                    <p className="mt-1 break-all font-mono text-[10px] text-slate-500 dark:text-white/45">
                      {readDeliveryRecipient(delivery)}
                    </p>
                    {delivery.lastErrorMessage ? (
                      <p className="mt-1 break-all text-[10px] font-semibold text-red-600 dark:text-red-300">
                        {delivery.lastErrorMessage}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <StatusPill value={delivery.status} tone={readDeliveryStatusTone(delivery.status)} />
                  </td>
                  <td className="px-3 py-3 font-mono text-slate-600 dark:text-white/60">
                    {delivery.attemptCount}/{delivery.maxAttempts}
                  </td>
                  <td className="px-3 py-3 text-slate-500 dark:text-white/50">
                    {formatDateTime(delivery.updatedAt, language)}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        aria-label={`${t.viewEvidence} ${delivery.id}`}
                        className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:text-blue-600 dark:border-white/10 dark:text-white/60"
                        onClick={() => setSelectedDelivery(delivery)}
                        type="button"
                      >
                        <FileSearch className="h-4 w-4" />
                      </button>
                      <button
                        aria-label={`${t.retry} ${delivery.id}`}
                        className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:text-blue-600 dark:border-white/10 dark:text-white/60"
                        disabled={mutationBusy}
                        onClick={() => retryDelivery(delivery)}
                        type="button"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {deliveries.length === 0 ? <EmptyState text={t.emptyDeliveries} /> : null}
          {deliveries.length > 0 && filteredDeliveries.length === 0 ? (
            <div className="mt-3">
              <EmptyState text={t.noMatchingDeliveries} />
            </div>
          ) : null}
        </div>
      </GlassCard>

      <DeliveryEvidenceDrawer
        delivery={selectedDelivery}
        language={language}
        open={Boolean(selectedDelivery)}
        onClose={() => setSelectedDelivery(undefined)}
      />
    </div>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: typeof Bot; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-blue-500 dark:text-primary" />
      <h4 className="text-sm font-bold text-slate-800 dark:text-white">{title}</h4>
    </div>
  );
}

function StatusPill({ tone, value }: { tone: 'blue' | 'green' | 'red' | 'slate'; value: string }) {
  const toneClass = {
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200',
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200',
    red: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200',
    slate: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/70'
  }[tone];

  return <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase ${toneClass}`}>{value}</span>;
}

function DeliveryRetryPreflight({
  language,
  selectedCount,
  summary,
  t
}: {
  language: AppLanguage;
  selectedCount: number;
  summary: DeliveryRetryPreflightSummary;
  t: TelegramCopy;
}) {
  const errorPreview = summary.errorLabels.slice(0, 4);

  return (
    <section
      aria-label={t.deliveryRetryPreflight}
      className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50/70 p-4 dark:border-cyan-300/15 dark:bg-cyan-400/[0.055]"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-cyan-700 dark:text-cyan-200">
            {t.deliveryRetryPreflight}
          </p>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600 dark:text-white/55">
            {t.deliveryRetryHint}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.typeLabels.slice(0, 4).map((label) => (
              <span
                className="rounded-full border border-cyan-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 dark:border-cyan-300/20 dark:bg-white/[0.04] dark:text-white/70"
                key={label}
              >
                {label}
              </span>
            ))}
            {summary.typeLabels.length > 4 ? (
              <span className="rounded-full border border-cyan-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500 dark:border-cyan-300/20 dark:bg-white/[0.04] dark:text-white/50">
                +{formatNumber(summary.typeLabels.length - 4, language)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-5 xl:w-[40rem]">
          <DeliveryRetryMetric label={t.selectedDeliveries} value={formatNumber(selectedCount, language)} />
          <DeliveryRetryMetric
            label={t.deliveryRetryFailed}
            value={formatNumber(summary.failedOrDeadLetterCount, language)}
          />
          <DeliveryRetryMetric label={t.deliveryRetryTargets} value={formatNumber(summary.targetLabels.length, language)} />
          <DeliveryRetryMetric label={t.deliveryRetryTypes} value={formatNumber(summary.typeLabels.length, language)} />
          <DeliveryRetryMetric label={t.deliveryRetryErrors} value={formatNumber(summary.errorLabels.length, language)} />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <DeliveryRetryPreview title={t.deliveryRetryDeliveryPreview} values={summary.deliveryLabels.slice(0, 5)} />
        <DeliveryRetryPreview title={t.deliveryRetryTargetPreview} values={summary.targetLabels.slice(0, 5)} />
        <DeliveryRetryPreview
          title={t.deliveryRetryErrorPreview}
          values={errorPreview.length > 0 ? errorPreview : [t.deliveryRetryNoError]}
          warning={errorPreview.length > 0}
        />
      </div>
    </section>
  );
}

function DeliveryRetryMetric({ label, value }: { label: string; value: string }) {
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

function DeliveryRetryPreview({ title, values, warning = false }: { title: string; values: string[]; warning?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-cyan-200 bg-white/70 p-3 dark:border-cyan-300/15 dark:bg-white/[0.025]">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{title}</p>
      <div className="mt-2 space-y-1.5">
        {values.map((value) => (
          <p
            className={`break-all rounded-md px-2 py-1.5 text-[11px] font-bold ${
              warning
                ? 'bg-amber-50 text-amber-800 dark:bg-amber-300/10 dark:text-amber-100'
                : 'bg-slate-50 text-slate-700 dark:bg-white/[0.04] dark:text-white/70'
            }`}
            key={value}
          >
            {value}
          </p>
        ))}
      </div>
    </div>
  );
}

function EvidenceMeta({ label, value }: { label: string; value?: string }) {
  if (!value) {
    return null;
  }

  return (
    <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/[0.04]">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <p className="mt-1 break-all font-mono text-[11px] font-semibold text-slate-700 dark:text-white/70">{value}</p>
    </div>
  );
}

function EvidenceTextBlock({ emptyText, label, value }: { emptyText: string; label: string; value?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
      <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      {value ? (
        <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">
          {value}
        </pre>
      ) : (
        <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-white/45">{emptyText}</p>
      )}
    </div>
  );
}

function DeliveryEvidenceDrawer({
  delivery,
  language,
  open,
  onClose
}: {
  delivery?: TelegramNotificationDelivery;
  language: AppLanguage;
  open: boolean;
  onClose: () => void;
}) {
  const t = copy[language];

  return (
    <ConfigDrawer
      description={delivery ? `${delivery.notificationType} · ${readDeliveryRecipient(delivery)}` : t.evidenceDescription}
      open={open}
      title={t.evidenceTitle}
      onClose={onClose}
    >
      {delivery ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-blue-500 dark:text-primary" />
              <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
                {t.deliverySummary}
              </p>
            </div>
            <p className="mt-3 text-sm font-bold text-slate-900 dark:text-white">{delivery.notificationType}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusPill value={delivery.status} tone={readDeliveryStatusTone(delivery.status)} />
              <StatusPill value={`${delivery.attemptCount}/${delivery.maxAttempts}`} tone="slate" />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-white/40">
              {t.deliveryContext}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <EvidenceMeta label={t.id} value={delivery.id} />
              <EvidenceMeta label={t.type} value={delivery.notificationType} />
              <EvidenceMeta label={t.recipient} value={readDeliveryRecipient(delivery)} />
              <EvidenceMeta label={t.statusLabel} value={delivery.status} />
              <EvidenceMeta label={t.policyId} value={delivery.policyId} />
              <EvidenceMeta label={t.templateId} value={delivery.templateId} />
              <EvidenceMeta label={t.dedupeKey} value={delivery.dedupeKey} />
              <EvidenceMeta label={t.payloadHash} value={delivery.payloadHash} />
              <EvidenceMeta label={t.createdAt} value={formatDateTime(delivery.createdAt, language)} />
              <EvidenceMeta label={t.updatedAt} value={formatDateTime(delivery.updatedAt, language)} />
              <EvidenceMeta label={t.nextAttemptAt} value={formatDateTime(delivery.nextAttemptAt, language)} />
              <EvidenceMeta
                label={t.lastAttemptAt}
                value={delivery.lastAttemptAt ? formatDateTime(delivery.lastAttemptAt, language) : undefined}
              />
              <EvidenceMeta
                label={t.deliveredAt}
                value={delivery.deliveredAt ? formatDateTime(delivery.deliveredAt, language) : undefined}
              />
              <EvidenceMeta
                label={t.deadLetteredAt}
                value={delivery.deadLetteredAt ? formatDateTime(delivery.deadLetteredAt, language) : undefined}
              />
            </div>
          </div>

          <EvidenceTextBlock
            emptyText={t.noEvidence}
            label={t.deliveryTarget}
            value={stringifyDeliveryEvidence(delivery.target)}
          />
          <EvidenceTextBlock emptyText={t.noEvidence} label={t.deliveryError} value={delivery.lastErrorMessage} />
          <EvidenceTextBlock emptyText={t.noEvidence} label={t.deliveryPreview} value={delivery.renderedPreviewRedacted} />
          <EvidenceTextBlock emptyText={t.noEvidence} label={t.deliveryPayload} value={delivery.payloadHash} />

          <div className="flex justify-end">
            <button
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-blue-600 dark:bg-white dark:text-slate-900 dark:hover:bg-primary"
              onClick={() => copyDeliveryEvidence(delivery)}
              type="button"
            >
              <Copy className="h-3.5 w-3.5" />
              {t.copyEvidence}
            </button>
          </div>
        </div>
      ) : null}
    </ConfigDrawer>
  );
}

function TextField({
  className = '',
  label,
  onChange,
  required,
  type = 'text',
  value
}: {
  className?: string;
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  value: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</span>
      <input
        className="mt-2 w-full rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-sm font-bold text-slate-800 outline-none dark:border-white/10 dark:bg-black/20 dark:text-white"
        onChange={(event) => onChange(event.target.value)}
        required={required}
        type={type}
        value={value}
      />
    </label>
  );
}

function TextAreaField({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</span>
      <textarea
        className="mt-2 min-h-[92px] w-full resize-y rounded-lg border border-slate-200 bg-white/70 px-3 py-2 font-mono text-xs font-bold text-slate-800 outline-none dark:border-white/10 dark:bg-black/20 dark:text-white"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function SelectField({
  children,
  label,
  onChange,
  value
}: {
  children: ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</span>
      <select
        className="glass-select-control mt-2 w-full rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-sm font-bold text-slate-800 outline-none dark:border-white/10 dark:bg-black/20 dark:text-white"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {children}
      </select>
    </label>
  );
}

function ToggleField({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-[64px] items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-white/10">
      <span className="text-xs font-bold text-slate-700 dark:text-white/70">{label}</span>
      <GlassToggle checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function ChoiceGrid({
  label,
  onToggle,
  options,
  selected
}: {
  label: string;
  onToggle: (value: string) => void;
  options: readonly string[];
  selected: readonly string[];
}) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3 xl:grid-cols-4">
        {options.map((option) => (
          <label
            key={option}
            className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-white/10"
          >
            <span className="break-all text-xs font-bold text-slate-700 dark:text-white/70">{option}</span>
            <GlassToggle checked={selected.includes(option)} onChange={() => onToggle(option)} />
          </label>
        ))}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 dark:bg-white/5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">{label}</p>
      <p className="mt-1 break-all text-xs font-bold text-slate-800 dark:text-white/80">{value}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-xs font-bold text-slate-500 dark:border-white/10 dark:text-white/45">
      <RefreshCw className="mx-auto mb-2 h-4 w-4" />
      {text}
    </div>
  );
}
