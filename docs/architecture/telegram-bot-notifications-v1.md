# OU-UI Next Telegram Bot Notifications V1

Last updated: 2026-06-06

This document describes the Telegram Bot notification and customer binding system for OU-UI Next. V1 now includes the core runtime surfaces: server-side settings/secrets, bindings, one-time challenges, policies, delivery history, public webhook handling, background long-polling, proactive traffic/expiry/system-alert schedule scans, delivery retry sweeps, Telegram `sendMessage` / `getUpdates`, the operator settings page, customer self-service commands, administrator bot commands, and delivery-health observability over existing OU-UI read models.

Reference inputs:

- 3X-UI repository: https://github.com/MHSanaei/3x-ui
- 3X-UI wiki, Advanced / Setting Telegram bot: https://github.com/MHSanaei/3x-ui/wiki/Advanced
- Current OU-UI Next read models and services: `CustomerReadModel`, `SubscriptionClientIdentity`, `Agent`, `QuotaPolicy`, `SystemAlert`, `SystemAlertNotificationDeliveryRecord`, `subscription-output`, `traffic-rollups`, and the service-backed `ControlPlaneApi`.

## Goals

- Let administrators configure one Telegram bot for operator alerts and customer self-service notifications.
- Let administrators bind Telegram users or chats to OU-UI customers and scoped resources without exposing raw customer identifiers, subscription tokens, UUIDs, passwords, or internal resource IDs to unbound users.
- Support customer-facing bot actions for traffic, expiry, subscription output links, node summary, and notification preferences.
- Support administrator-facing bot actions for system status, active alerts, depleted or expiring customers, customer search, test notification, and binding management.
- Reuse OU-UI Next's existing customer directory, subscription output, traffic rollup, quota policy, Agent telemetry, system alert lifecycle, notification retry/dead-letter, and audit architecture.
- Make notification policy configurable by language, quiet hours, notification kinds, traffic thresholds, expiry reminder days, and subscription-link permission.
- Keep Chinese (`zh-CN`) as the default language, with English (`en`) as an optional policy/template language.

## Non-Goals

- Do not copy 3X-UI bot code or preserve 3X-UI anonymous lookup behavior as-is.
- Do not make the V1 bot an unrestricted remote admin shell. Destructive admin actions, backup delivery, daily/weekly report fan-out, and richer interactive command workflows can iterate on top of the durable settings/binding/delivery foundation.
- Do not send raw database backups to Telegram by default.
- Do not expose bot token, subscription secret, UUID/password, access-token hash, credential hash, or raw subscription URL in API responses, structured logs, audit evidence, metrics labels, test snapshots, or delivery history.
- Do not make Telegram a replacement for the existing protected REST/SSE/API surfaces. It is a controlled notification and command facade over those surfaces.

## 3X-UI Reference And OU-UI Enhancements

3X-UI provides a useful capability baseline:

| Area | 3X-UI reference capability | OU-UI Next design decision |
| --- | --- | --- |
| Bot setup | Bot token, admin chat ID, bot proxy, custom Telegram Bot API server | Keep these settings, store token as a backend secret, never return token from APIs, and add webhook/long-polling mode, egress policy, timeout, retry, and delivery health. |
| Scheduled reports | Periodic reports through cron-like settings | Keep schedule support, but generate events from OU-UI read models and enqueue delivery records with dedupe keys. |
| Login and CPU alerts | Admin login and CPU threshold notifications | Map login to `security.login`; map CPU, memory, disk, load, runtime service, offline, and recovery to system-alert/Agent telemetry driven events. |
| Expiry and traffic warnings | Customer expiry and traffic threshold warnings | Extend to customer directory aggregation across Xray customer nodes, local subscription users, external subscription sources, and forwarding resources. |
| Customer menu | Customer can query traffic by UUID/password | Replace anonymous UUID/password lookup with admin-approved Telegram bindings and short-lived binding challenges. |
| Admin commands | Search by email, list inbounds, status, depleted users, backup | Keep admin search and status. Backup is disabled by default and should prefer an audited panel download workflow rather than Telegram document delivery. |
| Localization | Multi-language bot | Default to zh-CN with en templates and per-binding language. |

OU-UI enhancements are intentionally stronger than 3X-UI:

- Customer Directory is the top-level customer identity surface. Current `CustomerReadModel` already aggregates `customer-node`, `subscription`, and `forwarding` sources.
- Subscription notifications can include local Xray clients, subscription identities, external source sync status, output profile changes, and generated output formats.
- Agent host lifecycle, command outbox state, runtime apply failure, quota enforcement, and alert notification health already feed the active/resolved `SystemAlert` lifecycle.
- System alert webhooks already have durable per-channel delivery, retry, dead-letter, and observability metrics. Telegram admin alert delivery should plug into the same channel pattern where possible.
- Customer notifications need binding and per-recipient policy, so they need a Telegram-specific recipient resolver on top of the generic delivery semantics.

## Existing OU-UI Surfaces To Reuse

The bot should not query runtime files, Xray config, or external subscription URLs directly. It should reuse these service-backed surfaces:

| Existing source | Reuse in Telegram design |
| --- | --- |
| `GET /api/v1/customers` / `CustomerReadModel` | Customer directory, aggregate usage, limit, expiry, source counts, Agent/resource IDs, quota state. |
| `GET /api/v1/subscription-clients` / `SubscriptionClientIdentity` | Subscription user identity, formats, output profile, generated node count, quota/expiry status, access-token preview only. |
| `subscription-output` service | Generate Clash/Mihomo/Sing-box/URI/JSON output or subscription link only after binding/policy checks. |
| `GET /api/v1/subscription-nodes` / `SubscriptionInventoryNode` | Node count, protocol, region, health/status summaries without leaking raw URLs. |
| `GET /api/v1/traffic-rollups` | Current-period and historical metered usage by agent, xray-client, and forwarding dimensions. |
| `GET /api/v1/quota-policies` | Quota threshold and exceeded/disabled state across managed host, customer-node, subscription user, forwarding account, tunnel, and forwarding rule scopes. |
| `GET /api/v1/agents` | Agent online/offline/degraded state, CPU, memory, disk, load, latency, service health, traffic, and expiry. |
| `GET /api/v1/system-alerts` and `/events/v1/system-alerts` | Active/resolved system alert lifecycle and admin alert notifications. |
| `GET /api/v1/observability-metrics` | Admin status summaries, notification retry/dead-letter health, command outbox, audit, and quota metrics. |
| Audit hash chain | Evidence for settings changes, binding lifecycle, policy changes, denied commands, and sensitive delivery actions. |

Implementation note: the existing `SystemAlertNotificationDeliveryRecord` already models `pending`, `failed`, `delivered`, `dead_letter`, `attemptCount`, `nextAttemptAt`, and `lastErrorMessage`. Telegram admin `system.alert` fan-out should extend the existing notification channel concept. Customer-specific notifications need a parallel `TelegramNotificationDelivery` record because recipient policy and subscription-link restrictions are Telegram-specific, but it should use the same retry/dead-letter semantics and observability shape.

## Architecture Overview

```text
Scheduler / System Alert Lifecycle / Audit Events / Subscription Sync Events
        |
Telegram Notification Intent Builder
        |
Recipient Resolver
  - admin recipients from bot settings
  - customer recipients from chat/customer bindings
  - policy filters and quiet hours
        |
Template Renderer
  - zh-CN / en
  - Telegram MarkdownV2 or HTML escaping
  - secret redaction
        |
Delivery Queue
  - durable attempts
  - retry and dead-letter
  - delivery health alerts/metrics
        |
Telegram Sender
  - webhook replies for commands
  - Bot API sendMessage/editMessage/sendDocument
  - proxy/custom API server/timeout/rate limit
```

Command handling has a separate path:

```text
Telegram webhook or long-polling update
        |
Update verifier and rate limiter
        |
Command/session parser
        |
Binding/permission resolver
        |
Read-model query or mutation through ControlPlaneApi
        |
Escaped response through Telegram Sender
```

## Bot Configuration

Draft model:

```ts
type TelegramBotSettings = {
  id: 'telegram-bot';
  enabled: boolean;
  mode: 'webhook' | 'long_polling';
  botTokenSecretRef?: string;
  botTokenSet: boolean;
  botTokenPreview?: string;
  language: 'zh-CN' | 'en';
  adminChatIds: string[];
  adminTelegramUserIds: string[];
  webhookSecretPathHash?: string;
  webhookPublicBaseUrl?: string;
  longPollingAllowedUpdates: string[];
  proxy?: {
    kind: 'http' | 'socks5';
    urlSecretRef: string;
    urlPreview: string;
  };
  customApiBaseUrl?: string;
  egressAllowlist?: string[];
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
  schedules: Array<{
    id: string;
    kind: 'traffic_threshold_scan' | 'expiry_scan' | 'system_alert_scan' | 'daily_report' | 'weekly_report' | 'delivery_retry';
    expression: string; // cron, @daily, @weekly, @every 30s
    enabled: boolean;
  }>;
  defaultPolicyId: string;
  groupChatPolicy: 'admin_alerts_only' | 'allow_customer_notifications_explicit';
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};
```

Configuration rules:

- Bot token is secret material. Store through the backend secret facility or encrypted server-side storage. `GET` responses return only `botTokenSet` and an optional preview such as `123456:***`.
- Webhook mode requires a random secret path segment: `POST /telegram/webhook/{secret}`. The raw secret is shown once and stored only as a hash. Webhook is appropriate when the panel has a public HTTPS domain.
- Long polling is appropriate for local/self-hosted deployments without public exposure. It must run as a backend job with a bounded offset and shutdown-safe loop.
- Bot proxy supports HTTP and SOCKS5. Proxy URL can contain credentials, so it is a secret and must not appear in logs.
- Custom Bot API server is optional and must go through egress allowlist, timeout, and resolved-host safety checks.
- Admin chat IDs and Telegram user IDs are personal data. UI should show enough to operate but avoid unnecessary duplication in logs/audit.
- Group chats default to administrator alerts only. Customer subscription links are private-chat only unless an administrator explicitly enables group delivery for that binding and the policy allows it.

## Binding Model

Binding is split into chat identity, customer/resource scope, policy, and short-lived challenges.

```ts
type TelegramChatBinding = {
  id: string;
  telegramUserId?: string;
  telegramChatId: string;
  chatType: 'private' | 'group' | 'supergroup' | 'channel';
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

type TelegramCustomerBinding = {
  id: string;
  chatBindingId: string;
  customerId: string;
  customerNameSnapshot: string;
  scopeType: 'customer' | 'subscription-user' | 'xray-client' | 'forwarding-owner' | 'forwarding-rule';
  scopeId?: string;
  scopeLabelSnapshot?: string;
  permissions: {
    receiveNotifications: boolean;
    queryTraffic: boolean;
    queryExpiry: boolean;
    queryNodes: boolean;
    receiveSubscriptionLinks: boolean;
    manageNotificationPolicy: boolean;
  };
  status: 'active' | 'revoked';
  policyId?: string;
  createdAt: string;
  createdBy: string;
  revokedAt?: string;
  revokedBy?: string;
  revokeReason?: string;
  auditEvidenceId: string;
};

type TelegramBindingChallenge = {
  id: string;
  codeHash: string;
  codePreview: string;
  customerId: string;
  scopeType: TelegramCustomerBinding['scopeType'];
  scopeId?: string;
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

type TelegramCommandSession = {
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
```

Cardinality:

- One customer can bind many Telegram users or chats.
- One Telegram user can manage many customers or resource scopes.
- Multiple bindings can point to the same customer but different scopes.
- Revocation is per binding. Revoking a chat binding disables all customer bindings for that chat unless administrators migrate them.

## Binding Flows

Recommended secure flow:

1. Administrator opens the panel notification integration workspace and creates a binding challenge for a customer or resource scope.
2. Backend generates a one-time code with CSPRNG, stores only a hash, sets a short expiry such as 10 minutes, and writes audit evidence without the raw code.
3. Administrator gives the code to the customer through an out-of-band path.
4. Telegram user opens a private chat with the bot, sends `/start`, then enters the code.
5. Bot verifies the code, rate limits attempts, creates or activates `TelegramChatBinding`, creates `TelegramCustomerBinding`, consumes the challenge, and writes audit evidence.
6. Bot displays bound customer labels and the allowed menu. It does not show raw internal IDs.

Administrator direct-binding flow:

1. Administrator creates a binding with Telegram user ID or chat ID in the panel.
2. Binding starts as `pending_start` until the configured chat sends the bot a command or completes `/start <code>`.
3. The first command from the exact configured chat activates the chat binding before traffic, expiry, node, or subscription-link responses are sent.
4. Direct binding and activation both write audit evidence.

Bot-side admin binding flow:

1. Admin runs `/admin bindings` or uses inline menu.
2. Bot confirms the admin Telegram user ID is listed in `adminTelegramUserIds` or has a matching active admin chat setting.
3. Admin searches a customer by customer name, subscription identity, email-like label, or resource ID. Results are capped and redacted.
4. Admin creates or revokes binding challenges. The raw code is shown once to the admin and not stored.

Denied behavior:

- Unbound users can only see `/start`, language choice, and "enter binding code".
- Unbound users cannot search customers, enumerate subscriptions, test UUID/passwords, or infer whether a customer exists.
- Failed binding-code attempts are rate limited and audited after threshold. Exhausted challenges are revoked.

## Notification Policy

Draft model:

```ts
type TelegramNotificationPolicy = {
  id: string;
  ownerType: 'global-default' | 'customer-binding' | 'admin-recipient';
  ownerId: string;
  enabled: boolean;
  language: 'zh-CN' | 'en';
  notificationTypes: TelegramNotificationType[];
  forcedNotificationTypes: TelegramNotificationType[];
  quietHours?: {
    timezone: string;
    startLocalTime: string; // HH:mm
    endLocalTime: string; // HH:mm
    bypassSeverities: Array<'critical'>;
  };
  trafficThresholdPercents: number[]; // default [50, 80, 90, 100]
  expiryReminderDays: number[]; // default [7, 3, 1]
  allowSubscriptionLinks: boolean;
  allowedSubscriptionFormats: Array<'clash' | 'mihomo' | 'sing-box' | 'uri' | 'json'>;
  subscriptionLinkPrivateChatOnly: boolean;
  maxMessagesPerHour: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};
```

Policy resolution order:

1. Critical forced notifications from global policy, such as security and active critical system alerts for admins.
2. Binding-specific policy.
3. Customer-level or admin-recipient policy.
4. Global default policy.

Quiet hours delay non-critical notifications by setting `nextAttemptAt` after the quiet window. The delivery record should show `status: pending` with `blockedByPolicy: quiet_hours` or equivalent metadata. Critical notifications may bypass quiet hours only when the policy says so.

## Delivery Model

Draft customer/admin Telegram delivery model:

```ts
type TelegramNotificationDelivery = {
  id: string;
  dedupeKey: string;
  notificationType: TelegramNotificationType;
  recipientKind: 'customer-binding' | 'admin-chat';
  chatBindingId?: string;
  adminChatId?: string;
  customerBindingId?: string;
  policyId: string;
  templateId: string;
  language: 'zh-CN' | 'en';
  status: 'pending' | 'failed' | 'delivered' | 'dead_letter' | 'suppressed';
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
    scopeType?: TelegramCustomerBinding['scopeType'];
    scopeIdHash?: string;
    alertId?: string;
    quotaPolicyId?: string;
  };
};
```

Rules:

- Delivery records store redacted preview only. If a subscription link is included, the URL is generated at send time and not persisted in the delivery history.
- `dedupeKey` should include notification type, customer/scope, threshold or expiry day, billing period, and template version. This prevents repeated 80% traffic messages in the same billing window.
- The background schedule scanner generates `traffic.threshold` and `subscription.expiring` delivery records from customer, subscription-user, Xray-client, forwarding-owner, and forwarding-rule bindings, and `system.alert` delivery records for configured administrator chat IDs. It does not call Telegram directly; the retry sweep sends the queued records through the same persisted delivery path as manual retries.
- Retry uses bounded attempts from the Telegram Bot settings. Exhausted delivery becomes `dead_letter`.
- Telegram 429 responses honor `retry_after` when computing the next attempt time.
- Telegram blocked-bot and chat-not-found errors can set the chat binding to `blocked` after audit evidence and stop future customer notifications.
- Dead-letter and overdue Telegram deliveries produce administrator-visible delivery health through `/api/v1/observability-metrics` and `/metrics`.

## Notification Types

```ts
type TelegramNotificationType =
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
```

Mapping to existing sources:

| Notification type | Source |
| --- | --- |
| `traffic.threshold` | Scheduled scan over `CustomerReadModel`, `QuotaPolicy`, and `TrafficRollup` current billing period. |
| `quota.exceeded` | `QuotaPolicy.enforcementState` and `SystemAlert.kind === 'quota.exceeded'`. |
| `quota.reset` | `quota.reset` task/audit evidence and quota baseline changes. |
| `subscription.expiring` | `CustomerReadModel.expiresAt`, `SubscriptionClientIdentity.expiresAt`, Xray client expiry, forwarding rule expiry when available. |
| `subscription.updated` | Subscription source sync result, output profile change, generated node count changes, public output version changes. |
| `system.alert` | Existing active/resolved system alert lifecycle for admins. |
| `agent.offline` / `agent.recovered` | Existing `agent.offline` alert activation/resolution or Agent status transitions. |
| `runtime.service_unhealthy` | `agent.runtime_service_unhealthy` system alert and Agent runtime service health. |
| `security.login` | Operator session login success/failure events after auth layer adds this event source. |
| `command.dead_letter` | `command_outbox.dead_letter` system alert. |
| `command.reply` | Bot self-service replies such as traffic, expiry, node, subscription-link, help, and notification-policy responses. |
| `runtime.apply_failed` | `runtime.apply_health_failed`, `runtime.reload_failed`, and failed runtime apply task evidence. |
| `provider.sync_failed` / `provider.sync_warning` | `subscription_source.sync_failed` and `subscription_source.sync_warning` alerts or sync audit evidence. |

## Template Variables

Templates are global and language-aware. Recommended renderer mode is Telegram HTML because escaping rules are simpler than MarkdownV2; MarkdownV2 is acceptable only behind a strict escaping utility.

All template values must be escaped before insertion. No variable can inject Telegram formatting.

| Variable | Meaning |
| --- | --- |
| `customerName` | Customer display name from `CustomerReadModel.name`. |
| `scopeLabel` | Bound scope label, such as subscription display name or forwarding rule name. |
| `usedTraffic` | Human-readable current-period traffic used. |
| `trafficLimit` | Human-readable quota limit. |
| `remainingTraffic` | Human-readable remaining traffic. |
| `usagePercent` | Rounded usage percentage. |
| `resetDate` | Current billing window reset date. |
| `expireAt` | Expiry time for customer, subscription user, Xray client, or forwarding resource. |
| `daysRemaining` | Integer days before expiry. |
| `subscriptionFormat` | Selected output format, such as `Mihomo` or `Sing-box`. |
| `subscriptionUrl` | Subscription URL. Only available for private chat delivery when policy permits. Never persisted in delivery record. |
| `nodeCount` | Number of available nodes. |
| `protocols` | Deduped protocol summary. |
| `regions` | Deduped region summary. |
| `agentName` | Agent display name. |
| `agentStatus` | Agent online/degraded/offline status. |
| `alertSeverity` | System alert severity. |
| `alertKind` | System alert kind. |
| `alertTitle` | System alert title. |
| `alertMessage` | System alert message with sensitive fields redacted. |
| `deliveryId` | Redacted delivery identifier for support. |

Default Chinese examples should be concise:

```text
流量提醒：{customerName}
本周期已用 {usedTraffic} / {trafficLimit}（{usagePercent}%），剩余 {remainingTraffic}，重置日 {resetDate}。
```

```text
到期提醒：{customerName}
{scopeLabel} 将在 {daysRemaining} 天后到期，到期时间 {expireAt}。
```

## Customer Bot Commands And Menus

Implemented customer commands:

- `/start <code>`: Consume a one-time binding code and activate the Telegram chat.
- `/help` or `/menu`: Show the self-service command list without exposing resource identifiers.
- `/status`: Show account status, aggregate traffic, expiry, and resource counts for the bound customer/scope.
- `/traffic`: Show current-period usage and limit for the bound customer/scope.
- `/subscription [clash|mihomo|sing-box|uri|json]`: Send a subscription link when the binding permission and notification policy permit it. Links are private-chat only by default and are not persisted in delivery history.
- `/nodes`: Show customer node count, subscription generated-node count, forwarding rule count, and a capped label sample.
- `/expiry`: Show the nearest expiry state for customer, subscription user, Xray client, or forwarding scope.
- `/notify status|on|off`: Show or update the customer-binding notification policy.

Planned customer commands:

- `/unbind`: Request self-unbind for the current Telegram chat. Admin-forced bindings may require admin approval depending on policy.
- Rich `/settings`: Edit language, opt-in/out kinds, quiet hours, traffic thresholds, and expiry reminder days beyond the current `/notify` switch.

Menu shape:

```text
我的流量
我的订阅
我的节点
到期信息
通知设置
绑定管理
```

Customer command rules:

- When a Telegram user has multiple customer bindings, bot first asks which customer/scope to use.
- Subscription link output is private-chat only by default.
- `我的节点` returns summarized status only. It must not include other customers' raw URLs, UUIDs, passwords, `rawUrl`, access tokens, or internal IDs.
- If quota is exceeded, `/subscription` should explain the block and reference reset status, matching the existing `subscription.quota_exceeded` behavior.

## Administrator Bot Commands And Menus

Implemented administrator commands:

- `/admin`: Show admin menu after checking Telegram user ID/chat ID against admin settings.
- `/admin status`: Show Agent online/offline/degraded counts, alert counts, quota risk, command failures, and Telegram delivery failures.
- `/admin alerts`: Show active alerts grouped by severity and kind.
- `/admin quota`: Show exceeded, disabled, or 80%+ quota policies.
- `/admin expiring`: Show customers and subscription identities expiring in the next 14 days.
- `/admin search <query>`: Search customers and subscription identities by display labels. Results are capped and redacted.
- `/admin test`: Trigger a test notification to the current admin chat.
- `/admin bindings`: Show active binding, pending chat, pending challenge, and recent binding summary.

Planned administrator commands:

- `/admin inbounds`: Show customer-node/Xray inbound summary by Agent, status, protocol, and customer scope without exposing client credentials.
- `/admin depleted`: Dedicated depleted customer/resource view beyond the current `/admin quota` risk list.
- `/admin bindings create|revoke`: Create, revoke, or regenerate binding challenges from Telegram after interactive confirmation.
- `/admin backup`: Disabled by default. If enabled, only admins can request it, every request is audited, and Telegram delivery should avoid raw database documents unless explicitly configured.

Administrator menu:

```text
系统状态
系统告警
客户节点
搜索客户
耗尽客户
即将到期
绑定管理
测试通知
```

Backup design:

- Default: no database backup is sent to Telegram.
- Safer option: create an audited backup task and return a short-lived protected panel download link to the administrator in private chat.
- If document delivery is explicitly enabled, restrict to admin private chats, redact or exclude token/password material where possible, set file retention expectations, and record audit evidence with redacted metadata only.

## API Draft

All endpoints are protected operator APIs unless explicitly marked as Telegram webhook. Session-backed mutations require the existing CSRF behavior. Responses use the existing API envelope style.

### Settings

```http
GET /api/v1/integrations/telegram-bot/settings
```

Returns `TelegramBotSettings` without `botToken`, raw proxy URL, webhook secret, or credential hashes.

```http
PATCH /api/v1/integrations/telegram-bot/settings
```

Request draft:

```json
{
  "enabled": true,
  "mode": "long_polling",
  "botToken": "set-once-secret-value",
  "language": "zh-CN",
  "adminChatIds": ["123456789"],
  "adminTelegramUserIds": ["123456789"],
  "proxy": {
    "kind": "socks5",
    "url": "socks5://user:password@proxy.example.com:1080"
  },
  "customApiBaseUrl": "https://telegram-bot-api.example.com",
  "requestTimeoutMs": 5000
}
```

Rules:

- `botToken` and `proxy.url` are write-only.
- Clearing the token requires an explicit `clearBotToken: true`.
- Audit evidence records changed field names and token/proxy presence changes, not secret values.

### Test Notification

```http
POST /api/v1/integrations/telegram-bot/test
```

Request draft:

```json
{
  "target": {
    "kind": "admin-chat",
    "chatId": "123456789"
  },
  "templateId": "test.notification.zh-CN",
  "language": "zh-CN"
}
```

Response includes delivery ID and status, not message text if it contains sensitive variables.

### Bindings

```http
GET /api/v1/telegram-bindings
POST /api/v1/telegram-bindings
POST /api/v1/telegram-bindings/{bindingId}/revoke
```

`POST /api/v1/telegram-bindings` supports administrator direct binding:

```json
{
  "telegramUserId": "123456789",
  "telegramChatId": "123456789",
  "customerId": "customer:example",
  "scopeType": "customer",
  "permissions": {
    "receiveNotifications": true,
    "queryTraffic": true,
    "queryExpiry": true,
    "queryNodes": true,
    "receiveSubscriptionLinks": false,
    "manageNotificationPolicy": true
  }
}
```

Responses should mask chat/user IDs where practical in list views, for example `123***789`, while detail views remain protected operator-only.

### Binding Challenges

```http
POST /api/v1/telegram-binding-challenges
```

Request draft:

```json
{
  "customerId": "customer:example",
  "scopeType": "subscription-user",
  "scopeId": "sub-client-01",
  "expiresInSeconds": 600
}
```

Response draft:

```json
{
  "id": "tgbc_01",
  "code": "OU-123456",
  "codePreview": "OU-***456",
  "expiresAt": "2026-06-06T18:00:00.000Z"
}
```

Raw `code` is returned only once and is never stored.

### Policies

```http
GET /api/v1/telegram-notification-policies
PATCH /api/v1/telegram-notification-policies
PATCH /api/v1/telegram-notification-policies/{policyId}
```

Patch request supports notification kinds, thresholds, expiry days, language, quiet hours, allowed formats, and subscription-link permission. Collection-level patch updates the global default policy; `{policyId}` patch updates one binding/admin policy.

### Deliveries

```http
GET /api/v1/telegram-notification-deliveries
POST /api/v1/telegram-notification-deliveries/{deliveryId}/retry
```

Delivery list returns redacted previews and sanitized errors. It must not return raw Telegram request payloads when they contain subscription links.

### Webhook

```http
POST /telegram/webhook/{secret}
```

Rules:

- Public, unauthenticated by panel session, but authenticated by unguessable secret path and optional Telegram `X-Telegram-Bot-Api-Secret-Token` header.
- Does not reveal whether a binding code, customer, or resource exists in HTTP response details.
- Rate limits by Telegram user ID, chat ID, source IP, and command kind.
- Emits sanitized denied audit evidence for suspicious activity thresholds, not for every unknown message.

Long polling is not an HTTP API. It is a backend worker that calls Telegram `getUpdates`, advances offset durably, and passes updates into the same command handler.

## Frontend Workspace

Recommended location: a "通知集成" sub-area under Security Policy or a dedicated integration section. This should be a practical configuration workbench, not a marketing page.

Required panels:

- Bot status: not configured, configured, webhook/long-polling running, last successful delivery, last failed delivery, dead-letter count.
- Token setup: write-only token input, no echo after save, clear/rotate action.
- Admin recipients: chat IDs and Telegram user IDs, private/group marker, last seen, test action.
- Transport: webhook vs long polling, webhook secret rotation, proxy, custom API server, timeout, egress allowlist.
- Customer binding table: Telegram user/chat, username, customer, scope, status, last notification, policy, revoke.
- Binding challenge creation: customer picker, scope picker, TTL, raw code shown once.
- Notification policy editor: kinds, thresholds, expiry reminder days, quiet hours, language, subscription-link permission, allowed formats.
- Template preview/test send: sample variables only, redacted sensitive values.
- Delivery history: status, attempts, next retry, sanitized error, redacted preview.

## Security, Privacy, And Audit

Secrets and logs:

- Bot token, proxy credentials, webhook secret, subscription URL, UUID, password, auth secret, access token, token hash, and credential hash must not enter the frontend bundle, logs, audit cleartext, metrics labels, or snapshots.
- Structured logs should include delivery ID, chat binding ID hash, notification type, status, request ID, and sanitized error only.
- Telegram API errors containing URLs or tokens must be sanitized before persistence, following the existing webhook notification tests that redact secret URLs.

Access control:

- All operator APIs require existing protected control-plane authentication and authorization.
- Customer commands require active binding and scope permission.
- Admin commands require configured admin Telegram user/chat identity.
- Unbound users cannot enumerate customers, subscriptions, resources, or binding challenge metadata.
- Group chats are admin-alert-only by default.

Binding safety:

- Binding codes are short-lived, single-use, CSPRNG-generated, hash-stored, and attempt-limited.
- Direct admin bindings remain `pending_start` until the Telegram user activates the private chat.
- Revoke and permission changes take effect immediately and write audit evidence.

Template safety:

- Escape all Telegram HTML/Markdown special characters after variable formatting.
- Do not support arbitrary unescaped template helpers.
- Validate templates at save time with representative variables.

Network safety:

- Telegram Bot API calls support timeout, retry, custom API base URL, HTTP/HTTPS/SOCKS5 proxy dispatch, and egress allowlist.
- The production default path rejects unsupported custom API/proxy protocols, localhost/private/link-local/multicast targets, and DNS results that resolve into those ranges. `egressAllowlist` constrains both custom Bot API and stored proxy hosts before `sendMessage` / `getUpdates` dispatch through the configured proxy.
- Long polling must not log update payloads wholesale.

Audit evidence:

- Settings updated: `telegram_bot.settings.updated`.
- Token rotated/cleared: `telegram_bot.token.rotated` / `telegram_bot.token.cleared` with no token value.
- Challenge created/consumed/revoked/expired: `telegram_binding_challenge.*`.
- Binding created/revoked/permission changed: `telegram_binding.*`.
- Policy changed: `telegram_notification_policy.updated`.
- Test notification sent: `telegram_notification.test_sent`.
- Sensitive customer command denied: `telegram_command.denied`.
- Subscription link sent: `telegram_subscription_link.sent` with customer/binding IDs and format, but no URL.
- Delivery dead-lettered: `telegram_notification.dead_lettered`.

## Implementation Status

Delivered in the integrated V1 branch:

- Domain types for settings, bindings, policies, challenges, command sessions, deliveries, webhook updates, and long-polling results.
- Repository state and service-backed persistence for Telegram settings, backend-only secrets, chat bindings, customer bindings, binding challenges, challenge-code hashes, policies, deliveries, and long-polling offsets across in-memory, file, and sqlite-backed control-plane stores.
- Protected operator APIs plus HTTP client/server routes for settings, test notifications, binding create/revoke, challenge create/list, policy update/list, delivery list/retry, and manual long-polling.
- Public `POST /telegram/webhook/{secret}` update handling without operator CSRF, authenticated by the configured webhook secret path.
- Telegram Bot API `sendMessage` and `getUpdates` transport with request timeout, custom API base URL, retry-after parsing, HTTP/HTTPS/SOCKS5 proxy dispatch, custom API/proxy egress validation, and sanitized error persistence.
- Long-polling background job wiring through `createServiceBackedControlPlane`.
- Background proactive schedule scan wiring through `createServiceBackedControlPlane` for traffic threshold, expiry reminder, and administrator system-alert delivery enqueueing with structured skip counts and dedupe keys.
- Background delivery retry sweep for due `pending` / `failed` deliveries with persisted delivered/failed/dead-letter outcomes and Telegram delivery-health observability/Prometheus metrics.
- `/start <code>` binding challenge consumption, customer self-service commands, administrator commands, per-binding notification policy updates, private-chat subscription-link gating, and redacted delivery history.
- Operator UI for Telegram settings, binding challenges, direct bindings, policy editing, delivery history/retry, test sends, and admin account/session management.
- Tests covering persistence across restarts, webhook binding, long-polling offset advancement, background polling, customer commands, administrator commands, HTTP routes/client envelopes, frontend pages, and secret redaction.

Follow-up work still needed before calling Telegram V1 fully complete:

- Scheduled proactive scans for subscription updates, provider sync warnings, and daily/weekly reports.
- Rich interactive command sessions for multi-binding customer selection, `/unbind`, and in-chat binding create/revoke workflows.

## Test Plan

Unit tests:

- Settings sanitizer never returns bot token, proxy credentials, webhook secret, or hashes.
- Binding challenge stores only code hash, expires correctly, enforces attempt limits, and is single-use.
- Binding resolver handles one customer to many Telegram users and one Telegram user to many customers.
- Policy resolver applies global default, binding overrides, forced notifications, quiet hours, thresholds, and allowed formats.
- Telegram HTML/Markdown escaping prevents format injection.
- Template renderer redacts or omits unavailable sensitive variables.
- Dedupe key prevents repeated threshold and expiry notifications in the same billing window.
- Retry/dead-letter transitions match existing system-alert delivery semantics, including Telegram 429 `retry_after`.

Integration tests:

- Protected APIs require existing operator auth and CSRF for session-backed mutations.
- Audit evidence is written for settings, challenge, binding, policy, denied command, subscription link sent, and dead-letter transitions without raw secrets.
- Customer `/traffic` derives totals from `CustomerReadModel` and `QuotaPolicy`.
- Customer `/nodes` summarizes `SubscriptionInventoryNode` and Xray/local nodes without raw URLs.
- Customer `/subscription` returns links only in active private chat with policy permission.
- Background schedule scan enqueues traffic threshold, expiry reminder, and administrator system-alert notifications without direct Bot API calls; delivery retry sweep performs the actual send and preserves dedupe behavior.
- Admin `/status` uses `listAgents`, `getObservabilityMetrics`, and delivery health.
- Admin `/alerts` uses `listSystemAlerts` and active/resolved lifecycle events.
- Provider sync failure/warning maps to Telegram notification intent from subscription source state/system alerts.
- Bot transport honors HTTP/HTTPS/SOCKS5 proxy/custom API base URL/egress allowlist and sanitizes transport errors.

End-to-end tests:

- Fake Telegram Bot API server covers webhook and long-polling update flow.
- Binding code generated in panel can be consumed in Telegram private chat.
- Unbound chat cannot enumerate customers or subscription outputs.
- Revoked binding loses access immediately.
- Delivery failure retries and then dead-letters with admin-visible health.

Manual verification for implementation PRs:

- Confirm frontend never receives bot token after save.
- Confirm browser bundle search does not contain configured token values.
- Confirm logs and audit exports do not contain bot token, subscription URL, UUID/password, or access token.
- Confirm group chat cannot receive subscription links unless explicitly enabled.
