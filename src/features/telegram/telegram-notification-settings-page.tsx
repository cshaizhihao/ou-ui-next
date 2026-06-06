import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  BellRing,
  Bot,
  History,
  KeyRound,
  Link2,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Trash2
} from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
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
  TelegramNotificationPolicy,
  TelegramNotificationPolicyUpdateInput,
  TelegramNotificationType,
  TelegramSubscriptionFormat,
  TelegramTestNotificationInput
} from '../../domain';
import { telegramNotificationTypes, telegramSubscriptionFormats } from '../../domain';
import { formatDateTime } from '../shared/format';

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
    statusLabel: '状态'
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
    statusLabel: 'Status'
  }
} as const;

const scopeOptions: TelegramBindingScopeType[] = [
  'customer',
  'subscription-user',
  'xray-client',
  'forwarding-owner',
  'forwarding-rule'
];

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

  async function submitSettings(event: FormEvent) {
    event.preventDefault();
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

    await onTestNotification?.({
      target: {
        kind: 'binding',
        bindingId: selectedBindingId
      },
      language: settings.language
    });
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
                      onClick={() => onRevokeBinding?.(binding.id, 'operator requested revoke')}
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
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="border-b border-slate-200 text-[10px] uppercase tracking-widest text-slate-500 dark:border-white/10 dark:text-white/40">
              <tr>
                <th className="px-3 py-2">{t.target}</th>
                <th className="px-3 py-2">{t.statusLabel}</th>
                <th className="px-3 py-2">{t.attempts}</th>
                <th className="px-3 py-2">{t.updatedAt}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((delivery) => (
                <tr key={delivery.id} className="border-b border-slate-100 dark:border-white/5">
                  <td className="max-w-[280px] px-3 py-3">
                    <p className="font-bold text-slate-800 dark:text-white">{delivery.notificationType}</p>
                    <p className="mt-1 break-all font-mono text-[10px] text-slate-500 dark:text-white/45">
                      {delivery.customerBindingId ?? delivery.adminChatId ?? delivery.id}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <StatusPill value={delivery.status} tone={delivery.status === 'delivered' ? 'green' : delivery.status === 'failed' || delivery.status === 'dead_letter' ? 'red' : 'blue'} />
                  </td>
                  <td className="px-3 py-3 font-mono text-slate-600 dark:text-white/60">
                    {delivery.attemptCount}/{delivery.maxAttempts}
                  </td>
                  <td className="px-3 py-3 text-slate-500 dark:text-white/50">
                    {formatDateTime(delivery.updatedAt, language)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      aria-label={`${t.retry} ${delivery.id}`}
                      className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:text-blue-600 dark:border-white/10 dark:text-white/60"
                      disabled={mutationBusy}
                      onClick={() => onRetryDelivery?.(delivery.id)}
                      type="button"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {deliveries.length === 0 ? <EmptyState text={t.emptyDeliveries} /> : null}
        </div>
      </GlassCard>
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
