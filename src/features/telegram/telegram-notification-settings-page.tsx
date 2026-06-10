import { useEffect, useState, type FormEvent } from 'react';
import { Bot, CheckCircle2, LoaderCircle, Save } from 'lucide-react';
import type { AppLanguage } from '../../app/app-store';
import { GlassCard } from '../../components/ui/glass-card';
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

const copy = {
  zh: {
    title: 'Telegram 通知',
    subtitle: 'Bot Token 与接收 Chat ID。',
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
    failed: '保存失败，请重试'
  },
  en: {
    title: 'Telegram Notifications',
    subtitle: 'Bot Token and recipient Chat ID.',
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
    failed: 'Save failed. Try again'
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
  language,
  mutationBusy = false,
  settings,
  onUpdateSettings
}: TelegramNotificationSettingsPageProps) {
  const t = copy[language];
  const [draft, setDraft] = useState(() => settingsToDraft(settings));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'failed'>('idle');
  const saveDisabled = mutationBusy || saving;
  const chatIds = splitList(draft.chatId);

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
    <div className="mx-auto max-w-3xl space-y-5">
      <section className="stagger-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-800 dark:text-white">{t.title}</h3>
            <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-white/50">{t.subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={settings.botTokenSet ? 'green' : 'red'} value={settings.botTokenSet ? t.tokenReady : t.tokenMissing} />
            <StatusPill tone={settings.adminChatIds.length > 0 ? 'green' : 'slate'} value={settings.adminChatIds.length > 0 ? t.chatReady : t.chatMissing} />
          </div>
        </div>
      </section>

      <GlassCard className="stagger-2 p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-xl dark:hover:shadow-black/20">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-50 text-blue-600 dark:bg-primary/15 dark:text-primary">
            <Bot className="h-4 w-4" />
          </span>
          <h4 className="text-sm font-bold text-slate-800 dark:text-white">{t.panelTitle}</h4>
        </div>

        <form className="mt-5 space-y-4" onSubmit={submitSettings}>
          <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 transition duration-150 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 dark:border-white/10 dark:bg-white/[0.04] dark:focus-within:border-primary/60 dark:focus-within:ring-primary/10">
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

          <label className="block rounded-lg border border-slate-200 bg-white px-3 py-2 transition duration-150 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 dark:border-white/10 dark:bg-white/[0.04] dark:focus-within:border-primary/60 dark:focus-within:ring-primary/10">
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
              className="inline-flex min-h-10 items-center justify-center gap-2 px-4 text-xs font-bold transition duration-150 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
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
      </GlassCard>
    </div>
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
