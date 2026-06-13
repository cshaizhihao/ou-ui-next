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
    chatId: 'Chat ID',
    tokenReady: 'Token 已配置',
    tokenMissing: 'Token 未配置',
    chatReady: 'Chat ID 已配置',
    chatMissing: 'Chat ID 未配置',
    save: '保存',
    saving: '保存中',
    saved: '已保存',
    failed: '保存失败，请重试',
    telegramOperationsCockpit: 'Telegram 运营 cockpit',
    telegramControlRail: 'Telegram 控制轨',
    notificationDeliveryWorkspace: '通知投递工作区',
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
    chatId: 'Chat ID',
    tokenReady: 'Token configured',
    tokenMissing: 'Token missing',
    chatReady: 'Chat ID configured',
    chatMissing: 'Chat ID missing',
    save: 'Save',
    saving: 'Saving',
    saved: 'Saved',
    failed: 'Save failed. Try again',
    telegramOperationsCockpit: 'Telegram operations cockpit',
    telegramControlRail: 'Telegram control rail',
    notificationDeliveryWorkspace: 'Notification delivery workspace',
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

export function TelegramNotificationSettingsPage({
  bindings,
  deliveries,
  language,
  mutationBusy = false,
  policies,
  settings,
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
      <section aria-label={t.operationalOverview} className="stagger-1 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
            <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-white/50">{t.subtitle}</p>
            <p className="mt-3 font-mono text-[10px] font-black uppercase tracking-[0.24em] text-blue-600 dark:text-primary">
              {t.operationalOverview}
            </p>
            <p className="mt-2 max-w-3xl text-xs leading-6 text-slate-500 dark:text-white/50">{t.operationalOverviewHint}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={settings.botTokenSet ? 'green' : 'red'} value={settings.botTokenSet ? t.tokenReady : t.tokenMissing} />
            <StatusPill tone={settings.adminChatIds.length > 0 ? 'green' : 'slate'} value={settings.adminChatIds.length > 0 ? t.chatReady : t.chatMissing} />
          </div>
        </div>

        <WorkspaceCockpit aria-label={t.telegramOperationsCockpit} className="telegram-ops-cockpit stagger-2">
          <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(17rem,0.34fr)_minmax(0,1fr)]">
            <aside
              aria-label={t.telegramControlRail}
              className="telegram-ops-rail border-b border-slate-200/80 bg-slate-50/80 p-4 dark:border-white/[0.08] dark:bg-slate-950/42 lg:border-b-0 lg:border-r lg:p-5"
              role="complementary"
            >
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-xl border border-blue-200 bg-white text-blue-600 shadow-sm dark:border-primary/20 dark:bg-primary/10 dark:text-primary">
                  <Bot className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-bold text-slate-900 dark:text-white">{t.panelTitle}</h4>
                  <p className="mt-1 text-[11px] font-semibold text-slate-500 dark:text-white/45">
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

              <form className="mt-5 space-y-4" onSubmit={submitSettings}>
                <label className="block rounded-xl border border-slate-200 bg-white px-3 py-2 transition duration-150 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 dark:border-white/10 dark:bg-white/[0.04] dark:focus-within:border-primary/60 dark:focus-within:ring-primary/10">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                    {t.botToken}
                  </span>
                  <input
                    aria-label={t.botToken}
                    autoComplete="off"
                    className="mt-1 min-h-9 w-full bg-transparent font-mono text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-white/30"
                    disabled={saveDisabled}
                    onChange={(event) => setDraft((current) => ({ ...current, botToken: event.target.value }))}
                    type="password"
                    value={draft.botToken}
                  />
                </label>

                <label className="block rounded-xl border border-slate-200 bg-white px-3 py-2 transition duration-150 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 dark:border-white/10 dark:bg-white/[0.04] dark:focus-within:border-primary/60 dark:focus-within:ring-primary/10">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-white/40">
                    {t.chatId}
                  </span>
                  <input
                    aria-label={t.chatId}
                    autoComplete="off"
                    className="mt-1 min-h-9 w-full bg-transparent font-mono text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-white/30"
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
                      className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200"
                      role="status"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {t.saved}
                    </p>
                  ) : null}
                  {status === 'failed' ? (
                    <p
                      className="inline-flex min-h-9 items-center rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200"
                      role="alert"
                    >
                      {t.failed}
                    </p>
                  ) : null}
                </div>
              </form>
            </aside>

            <WorkspaceCockpitScroller aria-label={t.notificationDeliveryWorkspace} className="telegram-ops-workspace min-h-0">
              <div className="space-y-4 p-4 md:p-5">
                <div
                  aria-label={t.notificationPath}
                  className="telegram-ops-path-panel rounded-2xl border border-slate-200 bg-white/78 p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04]"
                  role="group"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <BellRing className="h-4 w-4 text-blue-500 dark:text-primary" />
                        <p className="text-sm font-semibold text-slate-800 dark:text-white">{t.notificationPath}</p>
                      </div>
                      <NotificationPath labels={[t.pathBot, t.pathAdminChat, t.pathBinding, t.pathDelivery]} />
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-black text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70">
                      {t.policyEnabled} {formatNumber(enabledPolicyCount, language)} / {formatNumber(policies.length, language)}
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {overviewMetrics.map((metric) => (
                      <OverviewMetric key={metric.label} {...metric} />
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.58fr)]">
                  <section
                    aria-label={t.deliveryEvidence}
                    className="telegram-ops-delivery-panel rounded-2xl border border-slate-200 bg-slate-50/82 p-4 dark:border-white/10 dark:bg-white/[0.03]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-white/40">
                        {t.deliveryEvidence}
                      </p>
                      <p className="text-xs font-black text-slate-700 dark:text-white/65">
                        {t.failedDeliveries} {formatNumber(failedDeliveryCount, language)} / {formatNumber(deliveries.length, language)}
                      </p>
                    </div>
                    {sortedDeliveries.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {sortedDeliveries.slice(0, 3).map((delivery) => (
                          <DeliveryRow delivery={delivery} key={delivery.id} language={language} />
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-white/45">{t.noDeliveries}</p>
                    )}
                  </section>

                  <section
                    aria-label={t.policyAndBinding}
                    className="rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-white/10 dark:bg-black/10"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-white/40">
                        {t.policyAndBinding}
                      </p>
                      <StatusPill tone={deliveryReady ? 'green' : 'slate'} value={deliveryReady ? t.deliveryReady : t.deliveryBlocked} />
                    </div>
                    <p className="mt-3 text-sm font-black text-slate-900 dark:text-white">
                      {latestDelivery ? latestDelivery.notificationType : t.noDeliveries}
                    </p>
                    <p className="mt-2 text-xs leading-6 text-slate-500 dark:text-white/50">
                      {latestDelivery?.renderedPreviewRedacted ?? t.noPreview}
                    </p>
                    <div className="mt-4 grid gap-2">
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
    <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
      {labels.map((label, index) => (
        <li className="flex min-w-0 items-center gap-2" key={label}>
          <span
            aria-hidden="true"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-blue-200 bg-white text-[11px] font-black text-blue-600 dark:border-primary/25 dark:bg-primary/10 dark:text-primary"
          >
            {index + 1}
          </span>
          <span className="truncate text-xs font-black text-slate-800 dark:text-white/80">{label}</span>
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
      ? 'border-orange-200 bg-orange-50/65 dark:border-orange-300/20 dark:bg-orange-400/[0.08]'
      : 'border-slate-200 bg-white/55 dark:border-white/10 dark:bg-black/10';
  const labelClass = tone === 'signal' ? 'text-orange-700 dark:text-orange-200' : 'text-slate-500 dark:text-white/40';
  const iconClass = tone === 'signal' ? 'text-orange-500 dark:text-orange-200' : 'text-blue-500 dark:text-primary';

  return (
    <article aria-label={label} className={`rounded-xl border p-4 ${cardClass}`}>
      <div className="flex items-center justify-between gap-3">
        <p className={`text-[10px] font-bold uppercase tracking-widest ${labelClass}`}>{label}</p>
        <Icon className={`h-4 w-4 ${iconClass}`} />
      </div>
      <p className="mt-2 text-xl font-black text-slate-900 dark:text-white">{value}</p>
      <p className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-slate-500 dark:text-white/50">{detail}</p>
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
    blue: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-primary/20 dark:bg-primary/10 dark:text-primary',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200',
    red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200',
    slate: 'border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70'
  }[tone];

  return (
    <div className={`min-w-0 rounded-xl border px-3 py-2 ${toneClass}`}>
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] opacity-70">{label}</p>
      <p className="mt-1 truncate text-xs font-black">{value}</p>
    </div>
  );
}

function PolicyBindingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-white/40">{label}</p>
      <p className="break-words text-xs font-black text-slate-800 dark:text-white/75">{value}</p>
    </div>
  );
}

function DeliveryRow({
  delivery,
  language
}: {
  delivery: TelegramNotificationDelivery;
  language: AppLanguage;
}) {
  const risky = delivery.status === 'failed' || delivery.status === 'dead_letter';

  return (
    <article
      aria-label={`${delivery.notificationType} ${delivery.status}`}
      className="telegram-ops-delivery-row grid gap-3 rounded-xl border border-slate-200 bg-white/74 p-3 dark:border-white/10 dark:bg-white/[0.04] md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {risky ? <AlertTriangle className="h-3.5 w-3.5 text-orange-500" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
          <p className="truncate text-xs font-black text-slate-800 dark:text-white/80">{delivery.notificationType}</p>
          <StatusPill tone={risky ? 'red' : 'green'} value={delivery.status} />
        </div>
        <p className="mt-1 truncate text-[11px] font-semibold text-slate-500 dark:text-white/45">
          {delivery.renderedPreviewRedacted ?? delivery.templateId}
        </p>
      </div>
      <p className="font-mono text-[11px] font-bold text-slate-500 dark:text-white/45">{formatDateTime(delivery.updatedAt, language)}</p>
    </article>
  );
}

function StatusPill({ tone, value }: { tone: 'green' | 'red' | 'slate'; value: string }) {
  const toneClass = {
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200',
    red: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200',
    slate: 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/70'
  }[tone];

  return <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase ${toneClass}`}>{value}</span>;
}
