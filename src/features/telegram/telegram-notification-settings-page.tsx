import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, BellRing, Bot, CheckCircle2, LoaderCircle, Save, Send, ShieldCheck, UsersRound } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { ResponsivePage, WorkspaceCockpit, WorkspaceCockpitScroller } from '../../components/layout/responsive-page';
import { GlowButton } from '../../components/ui/glow-button';
import type {
  TelegramBindingChallengeCreateInput,
  TelegramBindingChallengeCreateResult,
  TelegramBindingCreateInput,
  TelegramBindingReadModel,
  TelegramBotSettings,
  TelegramBotSettingsUpdateInput,
  TelegramNotificationDelivery,
  TelegramNotificationPolicy,
  TelegramNotificationPolicyUpdateInput,
  TelegramTestNotificationInput
} from '../../domain';
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
  botToken: string;
  chatId: string;
};

type OverviewMetricItem = {
  detail: string;
  icon: typeof Bot;
  label: string;
  tone?: 'signal';
  value: string;
};
type TelegramAcceptanceGateState = 'ready' | 'issues' | 'waiting';

type TelegramAcceptanceGate = {
  detail: string;
  label: string;
  state: TelegramAcceptanceGateState;
  value: string;
};

const copy = {
  zh: {
    title: 'Telegram 通知',
    subtitle: '集中查看 Bot 配置、客户绑定、默认策略和投递证据。',
    operationalOverview: '运营总览',
    operationalOverviewHint: '先确认 Bot、管理员 Chat、客户绑定和投递证据，再保存凭据或执行通知烟测。',
    notificationPath: '通知链路',
    pathBot: 'Bot 配置',
    pathAdminChat: '管理员 Chat',
    pathBinding: '客户绑定',
    pathDelivery: '投递证据',
    deliveryReady: '可投递',
    deliveryBlocked: '待配置',
    adminRecipients: '管理员 Chat',
    customerBindings: '客户绑定',
    policyCoverage: '策略覆盖',
    deliveryEvidence: '投递证据',
    failedDeliveries: '失败投递',
    policyEnabled: '策略开启',
    latestDelivery: '最近投递',
    noDeliveries: '暂无投递记录',
    noPreview: '暂无预览',
    panelTitle: 'Bot 配置',
    botToken: 'Bot Token',
    botTokenHint: '已保存 Token 不会回显。仅在轮换凭据时填写新 Token。',
    chatId: 'Chat ID',
    tokenReady: 'Token 已配置',
    tokenMissing: 'Token 未配置',
    chatReady: 'Chat ID 已配置',
    chatMissing: 'Chat ID 未配置',
    save: '保存',
    saving: '保存中',
    saved: '已保存',
    failed: '保存失败，请重试',
    retryDelivery: '重试投递',
    retryingDelivery: '重试中',
    retryQueued: '重试已排队',
    retryFailed: '重试失败',
    deliveryRetryStatus: '投递重试状态',
    telegramOperationsCockpit: 'Telegram 运营 cockpit',
    telegramControlRail: 'Telegram 控制轨',
    notificationDeliveryWorkspace: '通知投递工作区',
    notificationAcceptanceGates: '通知验收门禁',
    notificationAcceptanceGatesHint: '把凭据、策略、绑定、投递健康和烟测证据压缩到同一条放行线。',
    botCredentialGate: 'Bot 凭据',
    botCredentialGateDetail: 'Token 与管理员 Chat 必须同时就绪',
    policyCoverageGate: '策略覆盖',
    policyCoverageGateDetail: (enabledCount: number, totalCount: number, language: AppLanguage) =>
      `${formatNumber(enabledCount, language)} 开启 / ${formatNumber(totalCount, language)} 总策略`,
    bindingCoverageGate: '绑定覆盖',
    bindingCoverageGateDetail: (bindingCount: number, language: AppLanguage) =>
      `${formatNumber(bindingCount, language)} 个客户绑定可接收通知`,
    deliveryHealthGate: '投递健康',
    deliveryHealthGateDetail: (failedCount: number, totalCount: number, language: AppLanguage) =>
      `${formatNumber(failedCount, language)} 失败 / ${formatNumber(totalCount, language)} 总投递`,
    smokeEvidenceGate: '烟测证据',
    smokeEvidenceGateDetail: (lastTestAt: string | undefined, language: AppLanguage) =>
      lastTestAt ? formatDateTime(lastTestAt, language) : '尚未提交通知烟测',
    gateStateLabel: {
      ready: '就绪',
      issues: '异常',
      waiting: '等待'
    },
    policyAndBinding: '策略与绑定'
  },
  en: {
    title: 'Telegram Notifications',
    subtitle: 'Review Bot configuration, customer bindings, default policy, and delivery evidence.',
    operationalOverview: 'Operational Overview',
    operationalOverviewHint: 'Check the Bot, admin chats, customer bindings, and delivery evidence before saving credentials or running notification smoke.',
    notificationPath: 'Notification Path',
    pathBot: 'Bot Settings',
    pathAdminChat: 'Admin Chat',
    pathBinding: 'Customer Binding',
    pathDelivery: 'Delivery Evidence',
    deliveryReady: 'Ready to Deliver',
    deliveryBlocked: 'Needs Setup',
    adminRecipients: 'Admin Chats',
    customerBindings: 'Customer Bindings',
    policyCoverage: 'Policy Coverage',
    deliveryEvidence: 'Delivery Evidence',
    failedDeliveries: 'Failed Deliveries',
    policyEnabled: 'Policies Enabled',
    latestDelivery: 'Latest Delivery',
    noDeliveries: 'No delivery records yet',
    noPreview: 'No preview yet',
    panelTitle: 'Bot Settings',
    botToken: 'Bot Token',
    botTokenHint: 'Saved tokens are write-only. Enter a new token only when rotating credentials.',
    chatId: 'Chat ID',
    tokenReady: 'Token configured',
    tokenMissing: 'Token missing',
    chatReady: 'Chat ID configured',
    chatMissing: 'Chat ID missing',
    save: 'Save',
    saving: 'Saving',
    saved: 'Saved',
    failed: 'Save failed. Try again',
    retryDelivery: 'Retry Delivery',
    retryingDelivery: 'Retrying',
    retryQueued: 'Retry queued',
    retryFailed: 'Retry failed',
    deliveryRetryStatus: 'Delivery retry status',
    telegramOperationsCockpit: 'Telegram operations cockpit',
    telegramControlRail: 'Telegram control rail',
    notificationDeliveryWorkspace: 'Notification delivery workspace',
    notificationAcceptanceGates: 'Notification Acceptance Gates',
    notificationAcceptanceGatesHint: 'Collapse credential, policy, binding, delivery health, and smoke evidence into one release line.',
    botCredentialGate: 'Bot Credential',
    botCredentialGateDetail: 'Token and admin chat must both be ready',
    policyCoverageGate: 'Policy Coverage',
    policyCoverageGateDetail: (enabledCount: number, totalCount: number, language: AppLanguage) =>
      `${formatNumber(enabledCount, language)} enabled / ${formatNumber(totalCount, language)} total policies`,
    bindingCoverageGate: 'Binding Coverage',
    bindingCoverageGateDetail: (bindingCount: number, language: AppLanguage) =>
      `${formatNumber(bindingCount, language)} customer bindings can receive notifications`,
    deliveryHealthGate: 'Delivery Health',
    deliveryHealthGateDetail: (failedCount: number, totalCount: number, language: AppLanguage) =>
      `${formatNumber(failedCount, language)} failed / ${formatNumber(totalCount, language)} total deliveries`,
    smokeEvidenceGate: 'Smoke Evidence',
    smokeEvidenceGateDetail: (lastTestAt: string | undefined, language: AppLanguage) =>
      lastTestAt ? formatDateTime(lastTestAt, language) : 'No notification smoke submitted yet',
    gateStateLabel: {
      ready: 'Ready',
      issues: 'Issues',
      waiting: 'Waiting'
    },
    policyAndBinding: 'Policy and Binding'
  }
} as const;

function splitList(value: string) {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function settingsToDraft(settings: TelegramBotSettings): SettingsDraft {
  return {
    botToken: '',
    chatId: settings.adminChatIds.join(', ')
  };
}

function createTelegramAcceptanceGates({
  bindings,
  deliveries,
  enabledPolicyCount,
  failedDeliveryCount,
  language,
  policies,
  settings,
  t
}: {
  bindings: TelegramBindingReadModel[];
  deliveries: TelegramNotificationDelivery[];
  enabledPolicyCount: number;
  failedDeliveryCount: number;
  language: AppLanguage;
  policies: TelegramNotificationPolicy[];
  settings: TelegramBotSettings;
  t: (typeof copy)[AppLanguage];
}): TelegramAcceptanceGate[] {
  const credentialState: TelegramAcceptanceGateState =
    settings.enabled && settings.botTokenSet && settings.adminChatIds.length > 0 ? 'ready' : 'issues';
  const policyState: TelegramAcceptanceGateState =
    policies.length === 0 ? 'waiting' : enabledPolicyCount > 0 ? 'ready' : 'issues';
  const bindingState: TelegramAcceptanceGateState = bindings.length > 0 ? 'ready' : 'waiting';
  const deliveryState: TelegramAcceptanceGateState =
    failedDeliveryCount > 0 ? 'issues' : deliveries.length > 0 ? 'ready' : 'waiting';
  const smokeState: TelegramAcceptanceGateState = settings.lastTestAt ? 'ready' : 'waiting';

  return [
    {
      detail: t.botCredentialGateDetail,
      label: t.botCredentialGate,
      state: credentialState,
      value: t.gateStateLabel[credentialState]
    },
    {
      detail: t.policyCoverageGateDetail(enabledPolicyCount, policies.length, language),
      label: t.policyCoverageGate,
      state: policyState,
      value: t.gateStateLabel[policyState]
    },
    {
      detail: t.bindingCoverageGateDetail(bindings.length, language),
      label: t.bindingCoverageGate,
      state: bindingState,
      value: t.gateStateLabel[bindingState]
    },
    {
      detail: t.deliveryHealthGateDetail(failedDeliveryCount, deliveries.length, language),
      label: t.deliveryHealthGate,
      state: deliveryState,
      value: t.gateStateLabel[deliveryState]
    },
    {
      detail: t.smokeEvidenceGateDetail(settings.lastTestAt, language),
      label: t.smokeEvidenceGate,
      state: smokeState,
      value: t.gateStateLabel[smokeState]
    }
  ];
}

export function TelegramNotificationSettingsPage({
  bindings,
  deliveries,
  language,
  mutationBusy = false,
  policies,
  settings,
  onRetryDelivery,
  onUpdateSettings
}: TelegramNotificationSettingsPageProps) {
  const t = copy[language];
  const [draft, setDraft] = useState(() => settingsToDraft(settings));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'failed'>('idle');
  const saveDisabled = mutationBusy || saving;
  const chatIds = splitList(draft.chatId);
  const sortedDeliveries = useMemo(
    () => [...deliveries].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [deliveries]
  );
  const failedDeliveryCount = deliveries.filter(
    (delivery) => delivery.status === 'failed' || delivery.status === 'dead_letter'
  ).length;
  const enabledPolicyCount = policies.filter((policy) => policy.enabled).length;
  const deliveryReady = settings.enabled && settings.botTokenSet && settings.adminChatIds.length > 0;
  const latestDelivery = sortedDeliveries[0];
  const acceptanceGates = useMemo(
    () =>
      createTelegramAcceptanceGates({
        bindings,
        deliveries,
        enabledPolicyCount,
        failedDeliveryCount,
        language,
        policies,
        settings,
        t
      }),
    [bindings, deliveries, enabledPolicyCount, failedDeliveryCount, language, policies, settings, t]
  );
  const overviewMetrics: OverviewMetricItem[] = [
    {
      detail: deliveryReady ? t.deliveryReady : t.deliveryBlocked,
      icon: Bot,
      label: t.panelTitle,
      value: settings.botTokenSet ? t.tokenReady : t.tokenMissing
    },
    {
      detail: settings.adminChatIds.length > 0 ? settings.adminChatIds.map(maskIdentifier).join(', ') : t.chatMissing,
      icon: Send,
      label: t.adminRecipients,
      value: formatNumber(settings.adminChatIds.length, language)
    },
    {
      detail: bindings.length > 0 ? bindings.slice(0, 2).map((binding) => binding.customerBinding.customerNameSnapshot).join(', ') : t.chatMissing,
      icon: UsersRound,
      label: t.customerBindings,
      value: formatNumber(bindings.length, language)
    },
    {
      detail: `${t.failedDeliveries} ${formatNumber(failedDeliveryCount, language)} / ${formatNumber(deliveries.length, language)}`,
      icon: ShieldCheck,
      label: t.deliveryEvidence,
      tone: 'signal',
      value: `${formatNumber(enabledPolicyCount, language)} / ${formatNumber(policies.length, language)}`
    }
  ];

  useEffect(() => {
    setDraft(settingsToDraft(settings));
  }, [settings]);

  async function submitSettings(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setStatus('idle');

    try {
      const updated = await onUpdateSettings?.({
        enabled: true,
        ...(draft.botToken.trim() ? { botToken: draft.botToken.trim() } : {}),
        adminChatIds: chatIds
      });

      setDraft({
        botToken: '',
        chatId: (updated?.adminChatIds ?? chatIds).join(', ')
      });
      setStatus('saved');
    } catch {
      setStatus('failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResponsivePage className="telegram-notification-cockpit space-y-5 md:space-y-6">
      <section
        aria-label={t.operationalOverview}
        className="stagger-1 space-y-3 border border-[#07111F] bg-[#FFFDF5] p-4 shadow-[0_12px_30px_-26px_rgba(7,17,31,0.18)] dark:border-[#6B7CFF]/25 dark:bg-[#101827]"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-[#07111F] dark:text-white">{t.title}</h3>
            <p className="mt-1 text-xs font-semibold text-[#35405A] dark:text-white/50">{t.subtitle}</p>
            <p className="mt-3 font-mono text-[10px] font-black uppercase tracking-[0.24em] text-[#FF3D18] dark:text-[#FFB197]">
              {t.operationalOverview}
            </p>
            <p className="mt-2 max-w-3xl text-xs leading-6 text-[#35405A] dark:text-white/50">{t.operationalOverviewHint}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={settings.botTokenSet ? 'green' : 'red'} value={settings.botTokenSet ? t.tokenReady : t.tokenMissing} />
            <StatusPill tone={settings.adminChatIds.length > 0 ? 'green' : 'slate'} value={settings.adminChatIds.length > 0 ? t.chatReady : t.chatMissing} />
          </div>
        </div>

        <WorkspaceCockpit
          aria-label={t.telegramOperationsCockpit}
          className="telegram-ops-cockpit stagger-2 border-[#07111F]/25 bg-[#FFFDF5] dark:border-[#6B7CFF]/20 dark:bg-[#101827]"
        >
          <div className="telegram-ops-cockpit-grid grid min-h-0 grid-cols-1 xl:grid-cols-[18rem_minmax(0,1fr)]">
            <aside
              aria-label={t.telegramControlRail}
              className="telegram-ops-rail border-b border-[#07111F] bg-[#FFFDF5] p-3 dark:border-[#6B7CFF]/20 dark:bg-[#101827] xl:border-b-0 xl:border-r"
              role="complementary"
            >
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center border border-[#1E3AFF] bg-[#DCE1FF] text-[#1E3AFF] dark:border-[#6B7CFF]/25 dark:bg-[#6B7CFF]/14 dark:text-[#DDE3FF]">
                  <Bot className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-bold text-[#07111F] dark:text-white">{t.panelTitle}</h4>
                  <p className="mt-1 text-[11px] font-semibold text-[#35405A] dark:text-white/45">
                    {settings.enabled ? t.deliveryReady : t.deliveryBlocked}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2">
                <ControlRailMetric
                  label={t.botToken}
                  tone={settings.botTokenSet ? 'green' : 'red'}
                  value={settings.botTokenSet ? t.tokenReady : t.tokenMissing}
                />
                <ControlRailMetric
                  label={t.chatId}
                  tone={settings.adminChatIds.length > 0 ? 'green' : 'slate'}
                  value={settings.adminChatIds.length > 0 ? t.chatReady : t.chatMissing}
                />
                <ControlRailMetric
                  label={t.adminRecipients}
                  tone="blue"
                  value={formatNumber(settings.adminChatIds.length, language)}
                />
              </div>

              <TelegramAcceptanceGatePanel gates={acceptanceGates} t={t} />

              <form className="mt-4 space-y-3" onSubmit={submitSettings}>
                <label className="block border border-[#07111F]/25 bg-[#FFFDF5] px-3 py-2 transition duration-150 focus-within:border-[#1E3AFF] focus-within:ring-2 focus-within:ring-[#DCE1FF] dark:border-[#6B7CFF]/20 dark:bg-[#101827] dark:focus-within:border-[#6B7CFF]/60 dark:focus-within:ring-[#6B7CFF]/10">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">
                    {t.botToken}
                  </span>
                  <input
                    aria-label={t.botToken}
                    autoComplete="off"
                    className="mt-1 min-h-9 w-full bg-transparent font-mono text-sm font-semibold text-[#07111F] outline-none placeholder:text-[#35405A]/72 dark:text-white dark:placeholder:text-white/30"
                    disabled={saveDisabled}
                    onChange={(event) => setDraft((current) => ({ ...current, botToken: event.target.value }))}
                    type="password"
                    value={draft.botToken}
                  />
                  <span className="mt-1 block text-[11px] font-semibold leading-5 text-[#35405A] dark:text-white/45">
                    {t.botTokenHint}
                  </span>
                </label>

                <label className="block border border-[#07111F]/25 bg-[#FFFDF5] px-3 py-2 transition duration-150 focus-within:border-[#1E3AFF] focus-within:ring-2 focus-within:ring-[#DCE1FF] dark:border-[#6B7CFF]/20 dark:bg-[#101827] dark:focus-within:border-[#6B7CFF]/60 dark:focus-within:ring-[#6B7CFF]/10">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#35405A] dark:text-white/40">
                    {t.chatId}
                  </span>
                  <input
                    aria-label={t.chatId}
                    autoComplete="off"
                    className="mt-1 min-h-9 w-full bg-transparent font-mono text-sm font-semibold text-[#07111F] outline-none placeholder:text-[#35405A]/72 dark:text-white dark:placeholder:text-white/30"
                    disabled={saveDisabled}
                    onChange={(event) => setDraft((current) => ({ ...current, chatId: event.target.value }))}
                    value={draft.chatId}
                  />
                </label>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <GlowButton
                    className="inline-flex min-h-10 items-center justify-center gap-2 px-4 text-xs font-bold transition duration-150 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 max-lg:flex-1"
                    disabled={saveDisabled}
                    type="submit"
                  >
                    {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {saving ? t.saving : t.save}
                  </GlowButton>
                  {status === 'saved' ? (
                    <p
                      className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#00A878] bg-[#FFFDF5] px-3 text-xs font-bold text-[#007D5E] dark:border-[#35E68E]/20 dark:bg-[#101827] dark:text-[#9EF4C4]"
                      role="status"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {t.saved}
                    </p>
                  ) : null}
                  {status === 'failed' ? (
                    <p
                      className="inline-flex min-h-9 items-center rounded-lg border border-[#FF3D18] bg-[#FFD8C6] px-3 text-xs font-bold text-[#B93C17] dark:border-[#FF6A3A]/20 dark:bg-[#FF6A3A]/10 dark:text-[#FFB197]"
                      role="alert"
                    >
                      {t.failed}
                    </p>
                  ) : null}
                </div>
              </form>
            </aside>

            <WorkspaceCockpitScroller aria-label={t.notificationDeliveryWorkspace} className="telegram-ops-workspace min-h-0">
              <div className="space-y-3 p-3">
                <div
                  aria-label={t.notificationPath}
                  className="telegram-ops-path-panel border border-[#07111F]/25 bg-[#FFFDF5] p-3 shadow-[0_10px_26px_-24px_rgba(7,17,31,0.18)] dark:border-[#6B7CFF]/20 dark:bg-[#101827]"
                  role="group"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <BellRing className="h-4 w-4 text-[#1E3AFF] dark:text-[#DDE3FF]" />
                        <p className="text-sm font-semibold text-[#07111F] dark:text-white">{t.notificationPath}</p>
                      </div>
                      <NotificationPath labels={[t.pathBot, t.pathAdminChat, t.pathBinding, t.pathDelivery]} />
                    </div>
                    <div className="border border-[#07111F]/25 bg-[#DCE1FF] px-3 py-2 text-xs font-black text-[#07111F] dark:border-[#6B7CFF]/20 dark:bg-[#6B7CFF]/14 dark:text-white">
                      {t.policyEnabled} {formatNumber(enabledPolicyCount, language)} / {formatNumber(policies.length, language)}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
                    {overviewMetrics.map((metric) => (
                      <OverviewMetric key={metric.label} {...metric} />
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.58fr)]">
                  <section
                    aria-label={t.deliveryEvidence}
                    className="telegram-ops-delivery-panel border border-[#07111F]/25 bg-[#FFFDF5] p-3 dark:border-[#6B7CFF]/20 dark:bg-[#101827]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#35405A] dark:text-white/40">
                        {t.deliveryEvidence}
                      </p>
                      <p className="text-xs font-black text-[#07111F] dark:text-white/65">
                        {t.failedDeliveries} {formatNumber(failedDeliveryCount, language)} / {formatNumber(deliveries.length, language)}
                      </p>
                    </div>
                    {sortedDeliveries.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {sortedDeliveries.slice(0, 3).map((delivery) => (
                          <DeliveryRow
                            delivery={delivery}
                            key={delivery.id}
                            language={language}
                            onRetryDelivery={onRetryDelivery}
                            t={t}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm font-semibold text-[#35405A] dark:text-white/45">{t.noDeliveries}</p>
                    )}
                  </section>

                  <section
                    aria-label={t.policyAndBinding}
                    className="telegram-ops-policy-panel border border-[#07111F]/25 bg-[#FFFDF5] p-3 dark:border-[#6B7CFF]/20 dark:bg-[#101827]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#35405A] dark:text-white/40">
                        {t.policyAndBinding}
                      </p>
                      <StatusPill tone={deliveryReady ? 'green' : 'slate'} value={deliveryReady ? t.deliveryReady : t.deliveryBlocked} />
                    </div>
                    <p className="mt-3 text-sm font-black text-[#07111F] dark:text-white">
                      {latestDelivery ? latestDelivery.notificationType : t.noDeliveries}
                    </p>
                    <p className="mt-2 text-xs leading-6 text-[#35405A] dark:text-white/50">
                      {latestDelivery?.renderedPreviewRedacted ?? t.noPreview}
                    </p>
                    <div className="mt-3 grid gap-2">
                      <PolicyBindingRow label={t.policyCoverage} value={`${formatNumber(enabledPolicyCount, language)} / ${formatNumber(policies.length, language)}`} />
                      <PolicyBindingRow
                        label={t.customerBindings}
                        value={
                          bindings.length > 0
                            ? bindings.slice(0, 2).map((binding) => binding.customerBinding.customerNameSnapshot).join(', ')
                            : t.chatMissing
                        }
                      />
                      <PolicyBindingRow
                        label={t.adminRecipients}
                        value={settings.adminChatIds.length > 0 ? settings.adminChatIds.map(maskIdentifier).join(', ') : t.chatMissing}
                      />
                    </div>
                  </section>
                </div>
              </div>
            </WorkspaceCockpitScroller>
          </div>
        </WorkspaceCockpit>
      </section>
    </ResponsivePage>
  );
}

function maskIdentifier(value: string) {
  if (value.length <= 6) {
    return value;
  }

  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function NotificationPath({ labels }: { labels: string[] }) {
  return (
    <ol className="mt-3 grid grid-cols-1 gap-2 border border-[#1E3AFF] bg-[#DCE1FF]/55 p-2.5 sm:grid-cols-4 dark:border-[#6B7CFF]/25 dark:bg-[#6B7CFF]/12">
      {labels.map((label, index) => (
        <li className="flex min-w-0 items-center gap-2" key={label}>
          <span
            aria-hidden="true"
            className="grid h-7 w-7 shrink-0 place-items-center border border-[#1E3AFF] bg-[#DCE1FF] text-[11px] font-black text-[#1E3AFF] dark:border-[#6B7CFF]/25 dark:bg-[#6B7CFF]/14 dark:text-[#DDE3FF]"
          >
            {index + 1}
          </span>
          <span className="truncate text-xs font-black text-[#07111F] dark:text-white/80">{label}</span>
        </li>
      ))}
    </ol>
  );
}

function OverviewMetric({
  detail,
  icon: Icon,
  label,
  tone,
  value
}: {
  detail: string;
  icon: typeof Bot;
  label: string;
  tone?: 'signal';
  value: string;
}) {
  const cardClass =
    tone === 'signal'
      ? 'border-[#FF3D18]/35 bg-[#FFD8C6]/40 dark:border-[#FFB299]/20 dark:bg-[#FFB299]/10'
      : 'border-[#07111F]/25 bg-[#FFFDF5] dark:border-[#6B7CFF]/20 dark:bg-[#101827]';
  const labelClass = tone === 'signal' ? 'text-[#C92810] dark:text-[#FFB299]' : 'text-[#35405A] dark:text-white/40';
  const iconClass = tone === 'signal' ? 'text-[#FF3D18] dark:text-[#FFB299]' : 'text-[#1E3AFF] dark:text-[#DDE3FF]';

  return (
    <article aria-label={label} className={`telegram-ops-overview-card min-h-[80px] border p-3 ${cardClass}`}>
      <div className="flex items-center justify-between gap-3">
        <p className={`text-[10px] font-bold uppercase tracking-widest ${labelClass}`}>{label}</p>
        <Icon className={`h-4 w-4 ${iconClass}`} />
      </div>
      <p className="mt-1 text-xl font-black text-[#07111F] dark:text-white">{value}</p>
      <p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-[#35405A] dark:text-white/50">{detail}</p>
    </article>
  );
}

function ControlRailMetric({
  label,
  tone,
  value
}: {
  label: string;
  tone: 'blue' | 'green' | 'red' | 'slate';
  value: string;
}) {
  const toneClass = {
    blue: 'border-[#1E3AFF] bg-[#DCE1FF] text-[#1E3AFF] dark:border-[#6B7CFF]/25 dark:bg-[#6B7CFF]/14 dark:text-[#DDE3FF]',
    green: 'border-[#00A878] bg-[#FFFDF5] text-[#007D5E] dark:border-[#35E68E]/20 dark:bg-[#101827] dark:text-[#9EF4C4]',
    red: 'border-[#FF3D18] bg-[#FFD8C6] text-[#B93C17] dark:border-[#FF6A3A]/20 dark:bg-[#FF6A3A]/10 dark:text-[#FFB197]',
    slate: 'border-[#07111F]/20 bg-[#FFFDF5] text-[#35405A] dark:border-[#6B7CFF]/20 dark:bg-[#101827] dark:text-white/70'
  }[tone];

  return (
    <div className={`min-w-0 border px-3 py-2 ${toneClass}`}>
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] opacity-70">{label}</p>
      <p className="mt-1 truncate text-xs font-black">{value}</p>
    </div>
  );
}

function TelegramAcceptanceGatePanel({
  gates,
  t
}: {
  gates: TelegramAcceptanceGate[];
  t: (typeof copy)[AppLanguage];
}) {
  return (
    <section
      aria-label={t.notificationAcceptanceGates}
      className="telegram-acceptance-gate-panel mt-5 overflow-hidden border border-[#07111F] bg-[#FFFDF5] shadow-[0_18px_44px_-38px_rgba(7,17,31,0.42)] dark:border-[#6B7CFF]/30 dark:bg-white/[0.035]"
      role="region"
    >
      <div className="border-b border-[#07111F] bg-[#1E3AFF] px-3 py-2.5 text-white shadow-[inset_0_-3px_0_#D9FF00] dark:border-[#6B7CFF]/30 dark:bg-[#1E3AFF]/80">
        <p className="text-xs font-black uppercase tracking-widest">{t.notificationAcceptanceGates}</p>
        <p className="mt-1 text-[11px] leading-5 text-white/82">{t.notificationAcceptanceGatesHint}</p>
      </div>
      <div className="grid grid-cols-1 divide-y divide-[#07111F]/20 dark:divide-[#6B7CFF]/20">
        {gates.map((gate) => (
          <TelegramAcceptanceGateRow gate={gate} key={gate.label} />
        ))}
      </div>
    </section>
  );
}

function TelegramAcceptanceGateRow({ gate }: { gate: TelegramAcceptanceGate }) {
  const stateClass = {
    ready: 'border-[#00A878] bg-[#00A878]/[0.12] text-[#006B50] dark:bg-[#00A878]/[0.14] dark:text-[#7FF3C9]',
    issues: 'border-[#FF3D18] bg-[#FF3D18]/[0.13] text-[#C92810] dark:bg-[#FF6A3A]/[0.12] dark:text-[#FFB299]',
    waiting: 'border-[#D9FF00] bg-[#D9FF00]/[0.24] text-[#425200] dark:bg-[#D9FF00]/[0.12] dark:text-[#EAFF5A]'
  } satisfies Record<TelegramAcceptanceGateState, string>;

  return (
    <article
      aria-label={gate.label}
      className="telegram-acceptance-gate-row group relative min-h-[76px] px-3 py-2.5 transition-[background-color,transform] duration-200 ease-out hover:bg-[#EAF3D1]/70 motion-reduce:transition-none dark:hover:bg-white/[0.055]"
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

function PolicyBindingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="telegram-ops-policy-row grid gap-1 border border-[#07111F]/20 bg-[#FFFDF5] p-2.5 dark:border-[#6B7CFF]/20 dark:bg-[#101827]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#35405A] dark:text-white/40">{label}</p>
      <p className="break-words text-xs font-black text-[#07111F] dark:text-white/75">{value}</p>
    </div>
  );
}

function DeliveryRow({
  delivery,
  language,
  onRetryDelivery,
  t
}: {
  delivery: TelegramNotificationDelivery;
  language: AppLanguage;
  onRetryDelivery?: (deliveryId: string) => void | Promise<void>;
  t: (typeof copy)[AppLanguage];
}) {
  const risky = delivery.status === 'failed' || delivery.status === 'dead_letter';
  const retryable = risky && Boolean(onRetryDelivery);
  const [retryState, setRetryState] = useState<'idle' | 'busy' | 'queued' | 'failed'>('idle');

  async function retryDelivery() {
    if (!onRetryDelivery || retryState === 'busy') {
      return;
    }

    setRetryState('busy');

    try {
      await onRetryDelivery(delivery.id);
      setRetryState('queued');
    } catch {
      setRetryState('failed');
    }
  }

  return (
    <article
      aria-label={`${delivery.notificationType} ${delivery.status}`}
      className="telegram-ops-delivery-row grid gap-3 border border-[#07111F]/25 bg-[#FFFDF5] p-3 dark:border-[#6B7CFF]/20 dark:bg-[#101827] md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {risky ? <AlertTriangle className="h-3.5 w-3.5 text-[#FF3D18]" /> : <CheckCircle2 className="h-3.5 w-3.5 text-[#00A878]" />}
          <p className="truncate text-xs font-black text-[#07111F] dark:text-white/80">{delivery.notificationType}</p>
          <StatusPill tone={risky ? 'red' : 'green'} value={delivery.status} />
        </div>
        <p className="mt-1 truncate text-[11px] font-semibold text-[#35405A] dark:text-white/45">
          {delivery.renderedPreviewRedacted ?? delivery.templateId}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <p className="font-mono text-[11px] font-bold text-[#35405A] dark:text-white/45">
          {formatDateTime(delivery.updatedAt, language)}
        </p>
        {retryable ? (
          <button
            aria-label={t.retryDelivery}
            className="telegram-delivery-retry-action inline-flex min-h-8 items-center justify-center gap-2 border border-[#FF3D18] bg-[#FFD8C6]/72 px-3 text-[11px] font-black text-[#B93C17] transition hover:-translate-y-0.5 hover:bg-[#FFD8C6] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 motion-reduce:transition-none dark:border-[#FF6A3A]/30 dark:bg-[#FF6A3A]/12 dark:text-[#FFB197]"
            disabled={retryState === 'busy'}
            onClick={() => void retryDelivery()}
            type="button"
          >
            {retryState === 'busy' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {retryState === 'busy' ? t.retryingDelivery : t.retryDelivery}
          </button>
        ) : null}
        {retryState === 'queued' ? (
          <span
            aria-label={t.deliveryRetryStatus}
            className="inline-flex min-h-8 items-center border border-[#00A878] bg-[#FFFDF5] px-3 text-[11px] font-black text-[#007D5E] dark:border-[#35E68E]/20 dark:bg-[#101827] dark:text-[#9EF4C4]"
            role="status"
          >
            {t.retryQueued}
          </span>
        ) : null}
        {retryState === 'failed' ? (
          <span
            aria-label={t.deliveryRetryStatus}
            className="inline-flex min-h-8 items-center border border-[#FF3D18] bg-[#FFD8C6] px-3 text-[11px] font-black text-[#B93C17] dark:border-[#FF6A3A]/20 dark:bg-[#FF6A3A]/10 dark:text-[#FFB197]"
            role="alert"
          >
            {t.retryFailed}
          </span>
        ) : null}
      </div>
    </article>
  );
}

function StatusPill({ tone, value }: { tone: 'green' | 'red' | 'slate'; value: string }) {
  const toneClass = {
    green: 'border border-[#00A878] bg-[#FFFDF5] text-[#007D5E] dark:border-[#35E68E]/20 dark:bg-[#101827] dark:text-[#9EF4C4]',
    red: 'border border-[#FF3D18] bg-[#FFD8C6] text-[#B93C17] dark:border-[#FF6A3A]/20 dark:bg-[#FF6A3A]/10 dark:text-[#FFB197]',
    slate: 'border border-[#07111F]/20 bg-[#FFFDF5] text-[#35405A] dark:border-[#6B7CFF]/20 dark:bg-[#101827] dark:text-white/70'
  }[tone];

  return <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase ${toneClass}`}>{value}</span>;
}
