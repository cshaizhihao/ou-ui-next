export type TelegramBotLanguage = 'zh-CN' | 'en';

export type TelegramBotMode = 'webhook' | 'long_polling';

export type TelegramChatType = 'private' | 'group' | 'supergroup' | 'channel';

export type TelegramBindingScopeType =
  | 'customer'
  | 'subscription-user'
  | 'xray-client'
  | 'forwarding-owner'
  | 'forwarding-rule';

export type TelegramNotificationType =
  | 'traffic.threshold'
  | 'quota.exceeded'
  | 'quota.reset'
  | 'subscription.expiring'
  | 'subscription.updated'
  | 'system.alert'
  | 'agent.offline'
  | 'agent.recovered'
  | 'runtime.service_unhealthy'
  | 'security.login'
  | 'command.dead_letter'
  | 'command.reply'
  | 'runtime.apply_failed'
  | 'provider.sync_failed'
  | 'provider.sync_warning'
  | 'binding.created'
  | 'binding.revoked'
  | 'test.notification';

export type TelegramSubscriptionFormat = 'clash' | 'mihomo' | 'sing-box' | 'uri' | 'json';

export type TelegramBotSettings = {
  id: 'telegram-bot';
  enabled: boolean;
  mode: TelegramBotMode;
  botTokenSet: boolean;
  botTokenPreview?: string;
  language: TelegramBotLanguage;
  adminChatIds: string[];
  adminTelegramUserIds: string[];
  webhookSecretPathSet: boolean;
  webhookSecretPathPreview?: string;
  webhookPublicBaseUrl?: string;
  allowedUpdates: string[];
  proxy?: {
    kind: 'http' | 'socks5';
    urlSet: boolean;
    urlPreview?: string;
  };
  customApiBaseUrl?: string;
  egressAllowlist: string[];
  requestTimeoutMs: number;
  sendRateLimitPerSecond: number;
  retry: {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    maxDeliveriesPerSweep: number;
  };
  deliveryHistoryLimit: number;
  deadLetterRetentionDays: number;
  schedules: TelegramBotSchedule[];
  defaultPolicyId: string;
  groupChatPolicy: 'admin_alerts_only' | 'allow_customer_notifications_explicit';
  lastTestAt?: string;
  lastDeliveryAt?: string;
  lastDeliveryError?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

export type TelegramBotSchedule = {
  id: string;
  kind:
    | 'traffic_threshold_scan'
    | 'expiry_scan'
    | 'subscription_update_scan'
    | 'provider_sync_scan'
    | 'system_alert_scan'
    | 'daily_report'
    | 'weekly_report'
    | 'delivery_retry';
  expression: string;
  enabled: boolean;
};

export type TelegramBotSettingsUpdateInput = {
  enabled?: boolean;
  mode?: TelegramBotMode;
  botToken?: string;
  clearBotToken?: boolean;
  language?: TelegramBotLanguage;
  adminChatIds?: string[];
  adminTelegramUserIds?: string[];
  webhookSecretPath?: string;
  clearWebhookSecretPath?: boolean;
  webhookPublicBaseUrl?: string;
  allowedUpdates?: string[];
  proxy?: {
    kind: 'http' | 'socks5';
    url?: string;
    clearUrl?: boolean;
  };
  customApiBaseUrl?: string;
  egressAllowlist?: string[];
  requestTimeoutMs?: number;
  sendRateLimitPerSecond?: number;
  retry?: Partial<TelegramBotSettings['retry']>;
  deliveryHistoryLimit?: number;
  deadLetterRetentionDays?: number;
  schedules?: TelegramBotSchedule[];
  defaultPolicyId?: string;
  groupChatPolicy?: TelegramBotSettings['groupChatPolicy'];
  reason?: string;
};

export type TelegramChatBinding = {
  id: string;
  telegramUserId?: string;
  telegramChatId: string;
  chatType: TelegramChatType;
  username?: string;
  displayName?: string;
  status: 'pending_start' | 'active' | 'blocked' | 'revoked';
  isAdminRecipient: boolean;
  firstSeenAt: string;
  lastSeenAt?: string;
  lastStartAt?: string;
  source: 'bot_start' | 'admin_direct';
  createdAt: string;
  updatedAt: string;
};

export type TelegramCustomerBindingPermissions = {
  receiveNotifications: boolean;
  queryTraffic: boolean;
  queryExpiry: boolean;
  queryNodes: boolean;
  receiveSubscriptionLinks: boolean;
  manageNotificationPolicy: boolean;
};

export type TelegramCustomerBinding = {
  id: string;
  chatBindingId: string;
  customerId: string;
  customerNameSnapshot: string;
  scopeType: TelegramBindingScopeType;
  scopeId?: string;
  scopeLabelSnapshot?: string;
  permissions: TelegramCustomerBindingPermissions;
  status: 'active' | 'revoked';
  policyId?: string;
  createdAt: string;
  createdBy: string;
  revokedAt?: string;
  revokedBy?: string;
  revokeReason?: string;
  auditEvidenceId: string;
};

export type TelegramBindingReadModel = {
  id: string;
  chat: TelegramChatBinding;
  customerBinding: TelegramCustomerBinding;
  policy?: TelegramNotificationPolicy;
  lastDelivery?: TelegramNotificationDelivery;
};

export type TelegramBindingCreateInput = {
  telegramUserId?: string;
  telegramChatId: string;
  chatType?: TelegramChatType;
  username?: string;
  displayName?: string;
  customerId: string;
  customerName?: string;
  scopeType: TelegramBindingScopeType;
  scopeId?: string;
  scopeLabel?: string;
  permissions?: Partial<TelegramCustomerBindingPermissions>;
  policyId?: string;
};

export type TelegramBindingRevokeInput = {
  reason?: string;
};

export type TelegramBindingChallenge = {
  id: string;
  codePreview: string;
  customerId: string;
  customerNameSnapshot: string;
  scopeType: TelegramBindingScopeType;
  scopeId?: string;
  scopeLabelSnapshot?: string;
  expiresAt: string;
  maxAttempts: number;
  attemptCount: number;
  status: 'pending' | 'consumed' | 'expired' | 'revoked';
  createdBy: string;
  createdAt: string;
  consumedAt?: string;
  consumedByChatBindingId?: string;
  auditEvidenceId: string;
};

export type TelegramBindingChallengeCreateInput = {
  customerId: string;
  customerName?: string;
  scopeType: TelegramBindingScopeType;
  scopeId?: string;
  scopeLabel?: string;
  expiresInSeconds?: number;
  maxAttempts?: number;
};

export type TelegramBindingChallengeCreateResult = {
  challenge: TelegramBindingChallenge;
  code: string;
};

export type TelegramNotificationPolicy = {
  id: string;
  ownerType: 'global-default' | 'customer-binding' | 'admin-recipient';
  ownerId: string;
  enabled: boolean;
  language: TelegramBotLanguage;
  notificationTypes: TelegramNotificationType[];
  forcedNotificationTypes: TelegramNotificationType[];
  quietHours?: {
    timezone: string;
    startLocalTime: string;
    endLocalTime: string;
    bypassSeverities: Array<'critical'>;
  };
  trafficThresholdPercents: number[];
  expiryReminderDays: number[];
  allowSubscriptionLinks: boolean;
  allowedSubscriptionFormats: TelegramSubscriptionFormat[];
  subscriptionLinkPrivateChatOnly: boolean;
  maxMessagesPerHour: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

export type TelegramNotificationPolicyUpdateInput = {
  enabled?: boolean;
  language?: TelegramBotLanguage;
  notificationTypes?: TelegramNotificationType[];
  forcedNotificationTypes?: TelegramNotificationType[];
  quietHours?: TelegramNotificationPolicy['quietHours'] | null;
  trafficThresholdPercents?: number[];
  expiryReminderDays?: number[];
  allowSubscriptionLinks?: boolean;
  allowedSubscriptionFormats?: TelegramSubscriptionFormat[];
  subscriptionLinkPrivateChatOnly?: boolean;
  maxMessagesPerHour?: number;
  reason?: string;
};

export type TelegramNotificationDeliveryStatus = 'pending' | 'failed' | 'delivered' | 'dead_letter' | 'suppressed';

export type TelegramNotificationDelivery = {
  id: string;
  dedupeKey: string;
  notificationType: TelegramNotificationType;
  recipientKind: 'customer-binding' | 'admin-chat';
  chatBindingId?: string;
  adminChatId?: string;
  customerBindingId?: string;
  policyId: string;
  templateId: string;
  language: TelegramBotLanguage;
  status: TelegramNotificationDeliveryStatus;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string;
  attemptCount: number;
  maxAttempts: number;
  lastAttemptAt?: string;
  deliveredAt?: string;
  deadLetteredAt?: string;
  lastErrorMessage?: string;
  renderedPreviewRedacted?: string;
  payloadHash: string;
  target: {
    customerId?: string;
    scopeType?: TelegramBindingScopeType;
    scopeIdHash?: string;
    alertId?: string;
    quotaPolicyId?: string;
  };
};

export type TelegramTestNotificationInput = {
  target:
    | {
        kind: 'admin-chat';
        chatId: string;
      }
    | {
        kind: 'binding';
        bindingId: string;
      };
  templateId?: string;
  language?: TelegramBotLanguage;
};

export type TelegramWebhookUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    date?: number;
    text?: string;
    chat: {
      id: number | string;
      type: TelegramChatType;
      title?: string;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    from?: {
      id: number | string;
      is_bot?: boolean;
      username?: string;
      first_name?: string;
      last_name?: string;
      language_code?: string;
    };
  };
};

export type TelegramWebhookHandleResult = {
  accepted: boolean;
  action:
    | 'ignored'
    | 'binding_prompted'
    | 'binding_code_invalid'
    | 'binding_code_expired'
    | 'binding_consumed'
    | 'command_permission_denied'
    | 'command_policy_updated'
    | 'command_replied'
    | 'command_unbound'
    | 'command_unknown'
    | 'settings_disabled';
  binding?: TelegramBindingReadModel;
  delivery?: TelegramNotificationDelivery;
};

export type TelegramLongPollingResult = {
  enabled: boolean;
  fetchedCount: number;
  handledCount: number;
  nextOffset?: number;
  skippedReason?: 'settings_disabled' | 'mode_not_long_polling' | 'token_missing';
  errors: string[];
};

export type TelegramCommandSession = {
  id: string;
  chatBindingId: string;
  telegramMessageId?: string;
  state:
    | 'idle'
    | 'awaiting_binding_code'
    | 'selecting_customer'
    | 'selecting_subscription_format'
    | 'editing_notification_policy';
  selectedCustomerBindingId?: string;
  expiresAt: string;
  rateLimitBucketKey: string;
  updatedAt: string;
};

export const telegramNotificationTypes: TelegramNotificationType[] = [
  'traffic.threshold',
  'quota.exceeded',
  'quota.reset',
  'subscription.expiring',
  'subscription.updated',
  'system.alert',
  'agent.offline',
  'agent.recovered',
  'runtime.service_unhealthy',
  'security.login',
  'command.dead_letter',
  'command.reply',
  'runtime.apply_failed',
  'provider.sync_failed',
  'provider.sync_warning',
  'binding.created',
  'binding.revoked',
  'test.notification'
];

export const telegramSubscriptionFormats: TelegramSubscriptionFormat[] = [
  'clash',
  'mihomo',
  'sing-box',
  'uri',
  'json'
];

export const defaultTelegramCustomerBindingPermissions: TelegramCustomerBindingPermissions = {
  receiveNotifications: true,
  queryTraffic: true,
  queryExpiry: true,
  queryNodes: true,
  receiveSubscriptionLinks: false,
  manageNotificationPolicy: true
};
