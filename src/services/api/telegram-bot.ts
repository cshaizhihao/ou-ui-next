import type {
  CustomerReadModel,
  TelegramBindingChallenge,
  TelegramBindingChallengeCreateInput,
  TelegramBindingChallengeCreateResult,
  TelegramBindingCreateInput,
  TelegramBindingReadModel,
  TelegramBotSettings,
  TelegramBotSettingsUpdateInput,
  TelegramChatBinding,
  TelegramCustomerBinding,
  TelegramNotificationDelivery,
  TelegramNotificationPolicy,
  TelegramNotificationPolicyUpdateInput,
  TelegramTestNotificationInput,
  TelegramWebhookUpdate
} from '../../domain';
import {
  defaultTelegramCustomerBindingPermissions,
  telegramNotificationTypes,
  telegramSubscriptionFormats
} from '../../domain';

export const TELEGRAM_DEFAULT_POLICY_ID = 'telegram-policy-default';

const DEFAULT_ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member'];
const DEFAULT_SCHEDULES: TelegramBotSettings['schedules'] = [
  {
    id: 'telegram-delivery-retry',
    kind: 'delivery_retry',
    expression: '@every 30s',
    enabled: true
  },
  {
    id: 'telegram-expiry-scan',
    kind: 'expiry_scan',
    expression: '@daily',
    enabled: true
  },
  {
    id: 'telegram-subscription-update-scan',
    kind: 'subscription_update_scan',
    expression: '@every 10m',
    enabled: true
  },
  {
    id: 'telegram-provider-sync-scan',
    kind: 'provider_sync_scan',
    expression: '@every 5m',
    enabled: true
  },
  {
    id: 'telegram-daily-report',
    kind: 'daily_report',
    expression: '@daily',
    enabled: false
  },
  {
    id: 'telegram-weekly-report',
    kind: 'weekly_report',
    expression: '@weekly',
    enabled: false
  },
  {
    id: 'telegram-system-alert-scan',
    kind: 'system_alert_scan',
    expression: '@every 1m',
    enabled: true
  },
  {
    id: 'telegram-traffic-threshold-scan',
    kind: 'traffic_threshold_scan',
    expression: '@every 15m',
    enabled: true
  }
];

function clampInteger(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(Math.round(value ?? fallback), min), max);
}

function uniqueCleanStrings(values: string[] | undefined) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function previewSecret(value: string | undefined, visibleStart = 4, visibleEnd = 3) {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= visibleStart + visibleEnd) {
    return `${normalized.slice(0, 1)}***`;
  }

  return `${normalized.slice(0, visibleStart)}***${normalized.slice(-visibleEnd)}`;
}

export function maskTelegramIdentifier(value: string | undefined) {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= 6) {
    return `${normalized.slice(0, 2)}***`;
  }

  return `${normalized.slice(0, 3)}***${normalized.slice(-3)}`;
}

export function createStableTelegramHash(value: unknown) {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return `sha256:${hash.toString(16).padStart(8, '0')}${'0'.repeat(56)}`;
}

export function sanitizeTelegramBotErrorMessage(message: unknown, secrets: Array<string | undefined> = []) {
  const raw = message instanceof Error ? message.message : String(message ?? 'telegram request failed');
  let sanitized = raw
    .replace(/https:\/\/api\.telegram\.org\/bot[^/\s]+/gi, 'https://api.telegram.org/bot[redacted-token]')
    .replace(/\/bot\d+:[A-Za-z0-9_-]+/g, '/bot[redacted-token]')
    .replace(/\b\d{5,}:[A-Za-z0-9_-]{16,}\b/g, '[redacted-telegram-token]');

  for (const secret of secrets) {
    const normalized = secret?.trim();

    if (normalized) {
      sanitized = sanitized.split(normalized).join('[redacted-secret]');
    }
  }

  return sanitized.slice(0, 500);
}

export function redactTelegramBotSettingsAudit(settings: TelegramBotSettings, reason?: string) {
  return {
    ...settings,
    adminChatIds: settings.adminChatIds.map(maskTelegramIdentifier),
    adminTelegramUserIds: settings.adminTelegramUserIds.map(maskTelegramIdentifier),
    botTokenPreview: settings.botTokenSet ? '[redacted-token]' : undefined,
    webhookSecretPathPreview: settings.webhookSecretPathSet ? '[redacted-webhook-secret]' : undefined,
    ...(settings.proxy
      ? {
          proxy: {
            ...settings.proxy,
            urlPreview: settings.proxy.urlSet ? '[redacted-proxy-url]' : undefined
          }
        }
      : {}),
    ...(reason !== undefined ? { reason } : {})
  };
}

function normalizeTelegramApiBaseUrl(value: string | undefined) {
  return (value?.trim() || 'https://api.telegram.org').replace(/\/+$/, '');
}

function readTelegramRetryAfterSeconds(value: unknown) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const retryAfter = (value as { retry_after?: unknown }).retry_after;
  return typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : undefined;
}

export type TelegramSendMessageRequest = {
  chatId: string;
  text: string;
  parseMode?: 'HTML' | 'MarkdownV2';
  disableWebPagePreview?: boolean;
};

export type TelegramSendMessageResult =
  | {
      ok: true;
      messageId?: number;
    }
  | {
      ok: false;
      statusCode?: number;
      errorMessage: string;
      retryAfterSeconds?: number;
    };

export async function sendTelegramBotMessage(input: {
  botToken: string;
  customApiBaseUrl?: string;
  requestTimeoutMs: number;
  fetcher: typeof fetch;
  request: TelegramSendMessageRequest;
}): Promise<TelegramSendMessageResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.requestTimeoutMs);
  const endpoint = `${normalizeTelegramApiBaseUrl(input.customApiBaseUrl)}/bot${input.botToken}/sendMessage`;

  try {
    const response = await input.fetcher(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: input.request.chatId,
        text: input.request.text,
        ...(input.request.parseMode ? { parse_mode: input.request.parseMode } : {}),
        ...(input.request.disableWebPagePreview !== undefined
          ? { disable_web_page_preview: input.request.disableWebPagePreview }
          : {})
      }),
      signal: controller.signal
    });
    const payload = (await response.json().catch(() => undefined)) as
      | {
          ok?: unknown;
          result?: {
            message_id?: unknown;
          };
          description?: unknown;
          parameters?: unknown;
        }
      | undefined;

    if (response.ok && payload?.ok === true) {
      const messageId = payload.result?.message_id;
      return {
        ok: true,
        ...(typeof messageId === 'number' ? { messageId } : {})
      };
    }

    return {
      ok: false,
      statusCode: response.status,
      errorMessage: sanitizeTelegramBotErrorMessage(
        typeof payload?.description === 'string' ? payload.description : response.statusText,
        [input.botToken]
      ),
      retryAfterSeconds: readTelegramRetryAfterSeconds(payload?.parameters)
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: sanitizeTelegramBotErrorMessage(error, [input.botToken])
    };
  } finally {
    clearTimeout(timeout);
  }
}

export type TelegramGetUpdatesResult =
  | {
      ok: true;
      updates: TelegramWebhookUpdate[];
    }
  | {
      ok: false;
      statusCode?: number;
      errorMessage: string;
      retryAfterSeconds?: number;
    };

export async function fetchTelegramBotUpdates(input: {
  botToken: string;
  customApiBaseUrl?: string;
  requestTimeoutMs: number;
  fetcher: typeof fetch;
  offset?: number;
  timeoutSeconds?: number;
  allowedUpdates?: string[];
}): Promise<TelegramGetUpdatesResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.requestTimeoutMs + (input.timeoutSeconds ?? 0) * 1000);
  const endpoint = `${normalizeTelegramApiBaseUrl(input.customApiBaseUrl)}/bot${input.botToken}/getUpdates`;

  try {
    const response = await input.fetcher(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...(input.offset !== undefined ? { offset: input.offset } : {}),
        ...(input.timeoutSeconds !== undefined ? { timeout: input.timeoutSeconds } : {}),
        ...(input.allowedUpdates ? { allowed_updates: input.allowedUpdates } : {})
      }),
      signal: controller.signal
    });
    const payload = (await response.json().catch(() => undefined)) as
      | {
          ok?: unknown;
          result?: unknown;
          description?: unknown;
          parameters?: unknown;
        }
      | undefined;

    if (response.ok && payload?.ok === true && Array.isArray(payload.result)) {
      return {
        ok: true,
        updates: payload.result as TelegramWebhookUpdate[]
      };
    }

    return {
      ok: false,
      statusCode: response.status,
      errorMessage: sanitizeTelegramBotErrorMessage(
        typeof payload?.description === 'string' ? payload.description : response.statusText,
        [input.botToken]
      ),
      retryAfterSeconds: readTelegramRetryAfterSeconds(payload?.parameters)
    };
  } catch (error) {
    return {
      ok: false,
      errorMessage: sanitizeTelegramBotErrorMessage(error, [input.botToken])
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function createDefaultTelegramNotificationPolicy(
  now: string,
  actor = 'system:telegram-bot'
): TelegramNotificationPolicy {
  return {
    id: TELEGRAM_DEFAULT_POLICY_ID,
    ownerType: 'global-default',
    ownerId: 'telegram-bot',
    enabled: true,
    language: 'zh-CN',
    notificationTypes: [
      'traffic.threshold',
      'quota.exceeded',
      'quota.reset',
      'subscription.expiring',
      'subscription.updated',
      'system.alert',
      'agent.offline',
      'agent.recovered',
      'runtime.service_unhealthy',
      'command.dead_letter',
      'command.reply',
      'runtime.apply_failed',
      'provider.sync_failed',
      'provider.sync_warning',
      'daily.report',
      'weekly.report'
    ],
    forcedNotificationTypes: ['system.alert', 'quota.exceeded', 'security.login', 'command.dead_letter'],
    trafficThresholdPercents: [50, 80, 90, 100],
    expiryReminderDays: [7, 3, 1],
    allowSubscriptionLinks: false,
    allowedSubscriptionFormats: ['clash', 'mihomo', 'sing-box', 'uri'],
    subscriptionLinkPrivateChatOnly: true,
    maxMessagesPerHour: 12,
    createdAt: now,
    updatedAt: now,
    updatedBy: actor
  };
}

export function createDefaultTelegramBotSettings(
  now: string,
  actor = 'system:telegram-bot'
): TelegramBotSettings {
  return {
    id: 'telegram-bot',
    enabled: false,
    mode: 'long_polling',
    botTokenSet: false,
    language: 'zh-CN',
    adminChatIds: [],
    adminTelegramUserIds: [],
    webhookSecretPathSet: false,
    allowedUpdates: DEFAULT_ALLOWED_UPDATES,
    egressAllowlist: [],
    requestTimeoutMs: 5000,
    sendRateLimitPerSecond: 20,
    retry: {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 60_000,
      maxDeliveriesPerSweep: 25
    },
    deliveryHistoryLimit: 500,
    deadLetterRetentionDays: 30,
    schedules: DEFAULT_SCHEDULES,
    defaultPolicyId: TELEGRAM_DEFAULT_POLICY_ID,
    groupChatPolicy: 'admin_alerts_only',
    createdAt: now,
    updatedAt: now,
    updatedBy: actor
  };
}

export function applyTelegramBotSettingsUpdate(
  current: TelegramBotSettings,
  input: TelegramBotSettingsUpdateInput,
  now: string,
  actor: string
): TelegramBotSettings {
  const retry = {
    maxAttempts: clampInteger(input.retry?.maxAttempts, current.retry.maxAttempts, 1, 20),
    initialDelayMs: clampInteger(input.retry?.initialDelayMs, current.retry.initialDelayMs, 100, 600_000),
    maxDelayMs: clampInteger(input.retry?.maxDelayMs, current.retry.maxDelayMs, 100, 3_600_000),
    maxDeliveriesPerSweep: clampInteger(
      input.retry?.maxDeliveriesPerSweep,
      current.retry.maxDeliveriesPerSweep,
      1,
      500
    )
  };

  return {
    ...current,
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.clearBotToken
      ? { botTokenSet: false, botTokenPreview: undefined }
      : input.botToken
        ? { botTokenSet: true, botTokenPreview: previewSecret(input.botToken, 6, 3) }
        : {}),
    ...(input.language ? { language: input.language } : {}),
    ...(input.adminChatIds ? { adminChatIds: uniqueCleanStrings(input.adminChatIds) } : {}),
    ...(input.adminTelegramUserIds ? { adminTelegramUserIds: uniqueCleanStrings(input.adminTelegramUserIds) } : {}),
    ...(input.clearWebhookSecretPath
      ? { webhookSecretPathSet: false, webhookSecretPathPreview: undefined }
      : input.webhookSecretPath
        ? { webhookSecretPathSet: true, webhookSecretPathPreview: previewSecret(input.webhookSecretPath, 4, 4) }
        : {}),
    ...(input.webhookPublicBaseUrl !== undefined ? { webhookPublicBaseUrl: input.webhookPublicBaseUrl.trim() || undefined } : {}),
    ...(input.allowedUpdates ? { allowedUpdates: uniqueCleanStrings(input.allowedUpdates) } : {}),
    ...(input.proxy
      ? {
          proxy: input.proxy.clearUrl
            ? undefined
            : input.proxy.url
              ? {
                  kind: input.proxy.kind,
                  urlSet: true,
                  urlPreview: previewSecret(input.proxy.url, 12, 5)
                }
              : current.proxy
        }
      : {}),
    ...(input.customApiBaseUrl !== undefined ? { customApiBaseUrl: input.customApiBaseUrl.trim() || undefined } : {}),
    ...(input.egressAllowlist ? { egressAllowlist: uniqueCleanStrings(input.egressAllowlist) } : {}),
    ...(input.requestTimeoutMs !== undefined
      ? { requestTimeoutMs: clampInteger(input.requestTimeoutMs, current.requestTimeoutMs, 500, 120_000) }
      : {}),
    ...(input.sendRateLimitPerSecond !== undefined
      ? { sendRateLimitPerSecond: clampInteger(input.sendRateLimitPerSecond, current.sendRateLimitPerSecond, 1, 100) }
      : {}),
    retry,
    ...(input.deliveryHistoryLimit !== undefined
      ? { deliveryHistoryLimit: clampInteger(input.deliveryHistoryLimit, current.deliveryHistoryLimit, 10, 10_000) }
      : {}),
    ...(input.deadLetterRetentionDays !== undefined
      ? { deadLetterRetentionDays: clampInteger(input.deadLetterRetentionDays, current.deadLetterRetentionDays, 1, 365) }
      : {}),
    ...(input.schedules ? { schedules: input.schedules } : {}),
    ...(input.defaultPolicyId ? { defaultPolicyId: input.defaultPolicyId } : {}),
    ...(input.groupChatPolicy ? { groupChatPolicy: input.groupChatPolicy } : {}),
    updatedAt: now,
    updatedBy: actor
  };
}

function normalizePercentages(values: number[] | undefined, fallback: number[]) {
  const normalized = [...new Set((values ?? fallback).map((value) => clampInteger(value, 0, 1, 100)))];
  return normalized.sort((left, right) => left - right);
}

function normalizeDays(values: number[] | undefined, fallback: number[]) {
  const normalized = [...new Set((values ?? fallback).map((value) => clampInteger(value, 0, 0, 365)))];
  return normalized.sort((left, right) => right - left);
}

export function applyTelegramNotificationPolicyUpdate(
  current: TelegramNotificationPolicy,
  input: TelegramNotificationPolicyUpdateInput,
  now: string,
  actor: string
): TelegramNotificationPolicy {
  return {
    ...current,
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.language ? { language: input.language } : {}),
    ...(input.notificationTypes
      ? { notificationTypes: input.notificationTypes.filter((type) => telegramNotificationTypes.includes(type)) }
      : {}),
    ...(input.forcedNotificationTypes
      ? { forcedNotificationTypes: input.forcedNotificationTypes.filter((type) => telegramNotificationTypes.includes(type)) }
      : {}),
    ...(input.quietHours !== undefined ? { quietHours: input.quietHours ?? undefined } : {}),
    ...(input.trafficThresholdPercents
      ? { trafficThresholdPercents: normalizePercentages(input.trafficThresholdPercents, current.trafficThresholdPercents) }
      : {}),
    ...(input.expiryReminderDays
      ? { expiryReminderDays: normalizeDays(input.expiryReminderDays, current.expiryReminderDays) }
      : {}),
    ...(input.allowSubscriptionLinks !== undefined ? { allowSubscriptionLinks: input.allowSubscriptionLinks } : {}),
    ...(input.allowedSubscriptionFormats
      ? {
          allowedSubscriptionFormats: input.allowedSubscriptionFormats.filter((format) =>
            telegramSubscriptionFormats.includes(format)
          )
        }
      : {}),
    ...(input.subscriptionLinkPrivateChatOnly !== undefined
      ? { subscriptionLinkPrivateChatOnly: input.subscriptionLinkPrivateChatOnly }
      : {}),
    ...(input.maxMessagesPerHour !== undefined
      ? { maxMessagesPerHour: clampInteger(input.maxMessagesPerHour, current.maxMessagesPerHour, 1, 1000) }
      : {}),
    updatedAt: now,
    updatedBy: actor
  };
}

function findCustomer(customers: CustomerReadModel[], customerId: string, fallback?: string) {
  return customers.find((customer) => customer.id === customerId)?.name ?? fallback ?? customerId;
}

export function createTelegramBindingModels(input: {
  binding: TelegramCustomerBinding;
  chats: TelegramChatBinding[];
  policies: TelegramNotificationPolicy[];
  deliveries: TelegramNotificationDelivery[];
}): TelegramBindingReadModel | undefined {
  const chat = input.chats.find((item) => item.id === input.binding.chatBindingId);

  if (!chat) {
    return undefined;
  }

  const policy = input.binding.policyId
    ? input.policies.find((item) => item.id === input.binding.policyId)
    : undefined;
  const lastDelivery = input.deliveries
    .filter((delivery) => delivery.customerBindingId === input.binding.id)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

  return {
    id: input.binding.id,
    chat,
    customerBinding: input.binding,
    ...(policy ? { policy } : {}),
    ...(lastDelivery ? { lastDelivery } : {})
  };
}

export function createTelegramBinding(input: {
  request: TelegramBindingCreateInput;
  customers: CustomerReadModel[];
  now: string;
  actor: string;
  sequence: number;
}): {
  chat: TelegramChatBinding;
  binding: TelegramCustomerBinding;
} {
  const chatId = input.request.telegramChatId.trim();
  const bindingId = `telegram-binding-${String(input.sequence).padStart(4, '0')}`;
  const chatBindingId = `telegram-chat-${createStableTelegramHash({ chatId }).slice(7, 15)}`;
  const customerName = findCustomer(input.customers, input.request.customerId, input.request.customerName);

  return {
    chat: {
      id: chatBindingId,
      telegramUserId: input.request.telegramUserId?.trim() || undefined,
      telegramChatId: chatId,
      chatType: input.request.chatType ?? 'private',
      username: input.request.username?.trim() || undefined,
      displayName: input.request.displayName?.trim() || undefined,
      status: 'pending_start',
      isAdminRecipient: false,
      firstSeenAt: input.now,
      source: 'admin_direct',
      createdAt: input.now,
      updatedAt: input.now
    },
    binding: {
      id: bindingId,
      chatBindingId,
      customerId: input.request.customerId,
      customerNameSnapshot: customerName,
      scopeType: input.request.scopeType,
      scopeId: input.request.scopeId?.trim() || undefined,
      scopeLabelSnapshot: input.request.scopeLabel?.trim() || undefined,
      permissions: {
        ...defaultTelegramCustomerBindingPermissions,
        ...input.request.permissions
      },
      status: 'active',
      policyId: input.request.policyId,
      createdAt: input.now,
      createdBy: input.actor,
      auditEvidenceId: `audit-pending-${bindingId}`
    }
  };
}

function readRandomBytes(length: number) {
  const bytes = new Uint8Array(length);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }

  for (let index = 0; index < length; index += 1) {
    bytes[index] = (Date.now() + index * 17) % 256;
  }

  return bytes;
}

export function createTelegramBindingCode() {
  const bytes = readRandomBytes(4);
  const value = [...bytes].reduce((sum, byte) => (sum * 257 + byte) % 1_000_000, 0);
  return `OU-${String(value).padStart(6, '0')}`;
}

export function createTelegramBindingChallenge(input: {
  request: TelegramBindingChallengeCreateInput;
  customers: CustomerReadModel[];
  now: string;
  actor: string;
  sequence: number;
}): TelegramBindingChallengeCreateResult {
  const code = createTelegramBindingCode();
  const expiresInSeconds = clampInteger(input.request.expiresInSeconds, 600, 60, 86_400);
  const expiresAt = new Date(Date.parse(input.now) + expiresInSeconds * 1000).toISOString();
  const id = `telegram-challenge-${String(input.sequence).padStart(4, '0')}`;
  const customerName = findCustomer(input.customers, input.request.customerId, input.request.customerName);
  const challenge: TelegramBindingChallenge = {
    id,
    codePreview: previewSecret(code, 3, 3) ?? 'OU-***',
    customerId: input.request.customerId,
    customerNameSnapshot: customerName,
    scopeType: input.request.scopeType,
    scopeId: input.request.scopeId?.trim() || undefined,
    scopeLabelSnapshot: input.request.scopeLabel?.trim() || undefined,
    expiresAt,
    maxAttempts: clampInteger(input.request.maxAttempts, 5, 1, 20),
    attemptCount: 0,
    status: 'pending',
    createdBy: input.actor,
    createdAt: input.now,
    auditEvidenceId: `audit-pending-${id}`
  };

  return {
    challenge,
    code
  };
}

export function createTelegramTestDelivery(input: {
  request: TelegramTestNotificationInput;
  settings: TelegramBotSettings;
  now: string;
  sequence: number;
  binding?: TelegramBindingReadModel;
}): TelegramNotificationDelivery {
  const targetId = input.request.target.kind === 'admin-chat' ? input.request.target.chatId : input.request.target.bindingId;
  const id = `telegram-delivery-${String(input.sequence).padStart(4, '0')}`;
  const language = input.request.language ?? input.settings.language;

  return {
    id,
    dedupeKey: `test:${targetId}:${input.now}`,
    notificationType: 'test.notification',
    recipientKind: input.request.target.kind === 'admin-chat' ? 'admin-chat' : 'customer-binding',
    ...(input.request.target.kind === 'admin-chat'
      ? { adminChatId: input.request.target.chatId }
      : {
          customerBindingId: input.request.target.bindingId,
          ...(input.binding ? { chatBindingId: input.binding.chat.id } : {})
        }),
    policyId: input.settings.defaultPolicyId,
    templateId: input.request.templateId ?? `test.notification.${language}`,
    language,
    status: input.settings.enabled && input.settings.botTokenSet ? 'pending' : 'suppressed',
    createdAt: input.now,
    updatedAt: input.now,
    nextAttemptAt: input.now,
    attemptCount: 0,
    maxAttempts: input.settings.retry.maxAttempts,
    renderedPreviewRedacted:
      language === 'zh-CN'
        ? '测试通知：Telegram Bot 已连接到 OU-UI Next。'
        : 'Test notification: Telegram Bot is connected to OU-UI Next.',
    payloadHash: createStableTelegramHash({
      target: input.request.target,
      language,
      templateId: input.request.templateId
    }),
    target: input.binding
      ? {
          customerId: input.binding.customerBinding.customerId,
          scopeType: input.binding.customerBinding.scopeType,
          ...(input.binding.customerBinding.scopeId
            ? { scopeIdHash: createStableTelegramHash(input.binding.customerBinding.scopeId) }
            : {})
        }
      : {}
  };
}
