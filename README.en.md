# OU-UI Next

> Master-to-Any distributed gateway, traffic fabric, and Universal Agent control plane.

OU-UI Next is a production-oriented control plane for distributed gateways, forwarding fabrics, subscription orchestration, and Universal Agent lifecycle management. It turns the supplied HTML/Tailwind blueprint into an engineered Vite + React + TypeScript product with a typed frontend, a service-backed HTTP control plane, contract-validated APIs, and deployment automation.

Documentation is available in two languages:

- English: this file
- Simplified Chinese: [README.zh-CN.md](README.zh-CN.md)

## Product Positioning

OU-UI Next is built for operators who need one place to:

- manage Master-to-Any node enrollment and Universal Agent deployment
- orchestrate forwarding, quotas, subscription synthesis, and routing policy
- enforce auditable task transitions with rollback evidence
- keep the day-one experience approachable without removing operational structure

The practical goal is simple:

> Beginner-friendly, ready to run.

The repository includes an interactive one-click Master installer that asks only the required questions, then automates the normal deployment path. It is intended to reduce hand-built nginx configuration, manual certificate handling, and fragile multi-step panel bootstrap work.

## Architecture Blueprint

```text
 OOOOOOO  UU   UU        UU   UU IIIII  NN   NN EEEEEEE XX   XX TTTTTTT
OO     OO UU   UU        UU   UU  III   NNN  NN EE       XX XX    TTT
OO     OO UU   UU ------ UU   UU  III   NN N NN EEEEE     XXX     TTT
OO     OO UU   UU ------ UU   UU  III   NN  NNN EE       XX XX    TTT
 OOOOOOO   UUUUU          UUUUU  IIIII  NN   NN EEEEEEE XX   XX   TTT

[ Architecture: Master-to-Any Distributed Modular Matrix ]

+========================================================================+
|                     MASTER NODE (Control Plane)                        |
|                                                                        |
|  +----------------+  +-------------------+  +-----------------------+  |
|  | UI Dashboard   |  | Deployment Engine |  | Core Database         |  |
|  | (React/Vite)   |  | (SSH / Installer) |  | (Nodes/Rules/Stats)   |  |
|  +----------------+  +---------+---------+  +-----------------------+  |
|                                |                                       |
|                      +---------v---------+                             |
|                      |  Config Compiler  |                             |
|                      +-------------------+                             |
+================================|=======================================+
                                 |
   [ Secure Control Channel : SSH Deploy / WebSocket / gRPC API ]
   [ Master dynamically injects Agents, Configs & Protocol Binaries ]
                                 |
+------------------+-------------+-------------+------------------+------+
|                  |             |             |                  |      |
v                  v             v             v                  v      v
+----------+    +----------+  +----------+  +----------+       +----------+
| HOST 001 |    | HOST 002 |  | HOST 003 |  | HOST ... |  ...  | HOST N   |
+----------+    +----------+  +----------+  +----------+       +----------+
| AGENT    |    | AGENT    |  | AGENT    |  | AGENT    |       | AGENT    |
+==========+    +==========+  +==========+  +==========+       +==========+
| [x]Xray  |    | [x]Xray  |  | [ ]Xray  |  | runtime  |       | [x]Xray  |
| [x]Fwd   |    | [ ]Fwd   |  | [x]Fwd   |  | modules  |       | [x]Fwd   |
| [x]Health|    | [x]Health|  | [x]Health|  | telemetry|       | [x]Health|
+----------+    +----------+  +----------+  +----------+       +----------+
| quota    |    | quota    |  | quota    |  | policy   |       | quota    |
+----------+    +----------+  +----------+  +----------+       +----------+
```

## Current Engineering Surface

This repository currently includes:

- **Vite + React + TypeScript frontend**
  - application shell, navigation, dashboard, customer management, node, forwarding, subscription, routing, security, tuning, task, and audit surfaces
  - primary navigation now uses the production product terms for customer management, managed hosts, customer nodes, port forwarding, subscription management, routing policy, security policy, tuning, execution log, and audit log; the legacy "Node Subscriptions" entry label is no longer used
  - the login title is fixed to `OU-UI Next 控制面板`; the browser document title and the login card title stay aligned with the selected language, and username/password placeholders do not fall back to embedded admin defaults
  - built-in security-policy demo grants render `operator:bootstrap-owner`, not `operator:admin`, so the security workspace does not hint at an admin default account
  - configuration actions now open as in-page dialogs instead of long right-side panels; customer-node protocol dialogs keep Chinese-default field labels localized for flow, client fingerprint, Reality keys, and fallback targets while preserving a separate English copy path after language switch
  - Telegram Notifications and Admin Accounts are now real system-settings pages, not placeholders: operators can edit Telegram Bot settings, generate one-time binding codes, create/revoke customer bindings, update notification policies, send test notifications, retry deliveries, review login identity, view credential-rotation commands, and revoke operator sessions
  - customer-node creation now keeps protocol templates, VLESS/VMess/Trojan/Shadowsocks fields, Reality client material, subscription-link previews, and generated QR codes in the node workspace; the `qrcode` dependency is used only for client-side subscription QR rendering
  - the port-forwarding workspace surfaces quota state, billing direction, one-way vs bi-directional rate-limit direction, and explicit pause/resume actions so the UI matches the Agent runtime guardrails
- **Typed control-plane contracts**
  - OpenAPI spec: [docs/openapi/ou-ui-next-v1.yaml](docs/openapi/ou-ui-next-v1.yaml)
  - the OpenAPI V1 contract now covers the Telegram operator APIs, public webhook ingress, manual long-polling trigger, binding/policy/delivery schemas, and the Telegram fields returned in the dashboard snapshot
  - Zod request validation and API envelope handling
- **Service-backed HTTP control plane**
  - local backend entrypoint: `src/server/control-plane/http-control-plane-main.ts`
  - service/repository boundaries for tasks, audit, idempotency, outbox, runtime release models, and permission persistence
  - Telegram Bot V1 is wired through the service-backed API, HTTP client/server, mock API, and in-memory/file/sqlite repositories: settings and backend-only secrets, chat/customer bindings, binding challenges and hashed challenge codes, notification policies, delivery history, retry requests, webhook update handling, long-polling offsets, and audit evidence all persist across restarts without returning bot tokens, webhook secrets, proxy credentials, or raw subscription links
  - public Telegram updates enter through `POST /telegram/webhook/{secret}` without operator CSRF, authenticated by the configured secret path; long polling uses the same command handler through `getUpdates`, advances a durable offset, and can run as a configured background job
  - the production entrypoint now runs a Telegram delivery retry sweep for due `pending` / `failed` deliveries, honoring Bot API `retry_after`, configured max attempts, and per-sweep limits while persisting delivered/failed/dead-letter state into structured logs
  - Telegram Bot API egress on the production default fetch path now blocks localhost, private/link-local/multicast targets, and custom API/proxy hosts that resolve to those ranges; operators can constrain remote hosts with `egressAllowlist`, and persisted errors redact bot tokens, proxy URLs, and custom API URLs
  - implemented Telegram commands include customer `/start <code>`, `/help`, `/menu`, `/status`, `/traffic`, `/subscription`, `/nodes`, `/expiry`, `/notify status|on|off`, plus administrator `/admin`, `/admin status`, `/admin alerts`, `/admin quota`, `/admin expiring`, `/admin search`, `/admin test`, and `/admin bindings`; subscription links are private-chat/policy gated and redacted from delivery history
  - Telegram architecture and operator/security rules are documented in [docs/architecture/telegram-bot-notifications-v1.md](docs/architecture/telegram-bot-notifications-v1.md)
  - protected `/events/v1/tasks` streams cursor-resumable task-status history and audit snapshots first; task-status events replay the full durable `queued/running/succeeded/failed/...` chain from persisted audit evidence, then tail new task/audit events by polling the durable read model; the default sqlite-backed production deployment can continue follow-up task events across panel instances
  - protected `/events/v1/system-alerts` streams the current active system-alert snapshot and emits a new snapshot when the alert fingerprint changes; active alerts cover Agent offline state, sampling gaps, red high latency, required runtime service failures, command outbox overdue/dead-letter state, runtime apply health failures that triggered automatic rollback, runtime reload failures, external archive sink failures, subscription-source sync warning/failed state, and quota exceeded state; command outbox dead-letter alerts now include metadata counts for ACK timeout, result timeout, unknown, and other reasons, subscription-source alerts expose only source ID, name, status, node count, and a non-sensitive warning summary, external archive alerts include failed batch and failed record counts plus the latest failed archive kind, and the dashboard active-alert card surfaces those details directly so operators and SSE/webhook consumers can triage failures without querying raw rows; `ou-ui doctor` reports command timeout sweep enablement, ACK/result timeout, sweep interval, and max-command config health before backend startup; alerts then reconcile with a durable lifecycle read model and persist `active` / `resolved` evidence in the control-plane store; when `OU_UI_SYSTEM_ALERT_WEBHOOK_URL` or `OU_UI_SYSTEM_ALERT_WEBHOOK_URLS` is configured, alert activation, meaningful updates, and resolution enqueue sanitized JSON webhook notifications per channel in a durable retry/dead-letter queue; the default delivery path blocks localhost/private/link-local/multicast targets and targets that resolve to those addresses, optionally enforces `OU_UI_SYSTEM_ALERT_WEBHOOK_EGRESS_ALLOWLIST`, pins delivery to the verified public address, and records sanitized structured delivery logs with channel IDs and labels; `ou-ui doctor` reports configured alert webhook targets, host diagnostics, allowlist, retry timings, invalid positive-integer settings, and bearer-token presence without printing the token
  - service-backed read APIs rebuild the current durable read model from persisted tasks, Agent events, and subscription state before returning, so managed-host, subscription, and port-forwarding snapshots converge across sibling sqlite-backed panel instances without relying on one process memory image or a restart replay
  - protected `/api/v1/observability-metrics` returns an operator diagnostics snapshot for task states, completion latency, rollback counts, command outbox backlog/leases/overdue/dead-letter counts, ACK/result latency, Agent offline/degraded counts, system-alert severity and kind counts including Agent offline, command outbox overdue/dead-letter, runtime apply health failed, runtime reload failed, external archive sink failed, subscription-source sync warning/failed, and quota exceeded alerts, system-alert webhook retry/dead-letter counts plus per-channel delivery health, Telegram delivery pending/failed/delivered/dead-letter/suppressed/overdue health, quota policy totals/exceeded/disabled/scope/enforcement-state/used and limit bytes, retained Agent log chunk totals/bytes/time ranges, Agent log archive bucket/chunk/byte/time-range totals, retained traffic rollup totals, per-dimension counts, earliest/latest sample timestamps, cumulative metered bytes, audit-chain verification state, denied audit counts, quota-exceeded audit counts, and external archive sink failure counts plus failed record counts
  - protected `/metrics` exposes the current diagnostics snapshot as Prometheus text gauges for external scraping, includes quota policy scope/state/used/limit time series, external archive sink failure and failed-record counters, system-alert notification `channel_id` / `channel_label` / `status` series, Telegram delivery `status` series, and renders task completion, per-operation completion, runtime apply, command ACK, and command result latency as `_bucket` / `_sum` / `_count` histograms
  - the production entrypoint emits JSON structured logs for HTTP requests, errors, tasks, Agent poll/events, and command dispatch with `requestId`, `traceId`, `taskId`, `commandId`, `agentId`, and related diagnostics fields
  - Agent runtime log chunks are retrievable and exportable through protected APIs and pruned by the effective retention policy, defaulting to 7 days and 5000 chunks per Agent; `ou-ui doctor` reports Agent log retention days and per-Agent max-event config health before backend startup; the real Agent now emits bounded `log_chunk` events after command ACK and before command result, carrying runtime command/exit-code details, stdout/stderr fragments, and a result summary with a default cap of 20 chunks per command and each chunk below the backend 64 KiB contract limit; the Master deduplicates chunks by Agent / task / command / `chunkSeq`, so APIs, exports, and metrics do not repeat the same logical chunk; `GET /api/v1/agent-log-chunks:export` exports JSONL/JSON diagnostics by Agent, task, command, and time window; retention-pruned chunks are compacted into UTC-day archive summaries grouped by Agent, task, command, and stream, keeping chunk counts, byte totals, sessions, time ranges, and content hashes without retaining full log text; protected `/api/v1/agent-log-archives` plus `/api/v1/agent-log-archives:export` expose those summaries, and the execution workspace displays and exports them; when `OU_UI_EXTERNAL_ARCHIVE_DIRECTORY` is configured, newly produced Agent log archive summaries are also appended to `agent-log-archives.jsonl` in that external archive directory; `ou-ui doctor` also diagnoses external archive webhook target hosts, private/local targets, invalid URL protocols, bearer-token presence, invalid timeout settings, and object-storage timeout/path-style setting errors without printing webhook secrets; `GET/PATCH /api/v1/agent-log-retention-policy`, snapshots, and the execution workspace surface and edit the active policy, persist overrides in the control-plane store, append `agent.log_retention.updated` audit evidence, and apply the policy to subsequent Agent `log_chunk` pruning
  - Agent HTTP poll leases record safe `leaseOwnerId` and `leaseSessionId` values in the command outbox read model; when Agent auth is enabled the owner is the credential ID, never the runtime token
  - protected `/api/v1/agent-sessions` exposes sanitized Agent session liveness/progress, including session status, event seq, poll-side `lastSeenCommandSeq`, latest heartbeat, version, and capabilities; the permissions workspace renders those bound-session diagnostics inline with sanitized Agent credential rows
  - successful one-command Agent registration immediately projects a `provisioning` managed host with registration version, platform, and capability metadata; managed-host cards surface the status badge and registration metadata immediately, and only real heartbeat or telemetry promotes the host to online
  - Agent telemetry now reports CPU, memory, disk, Linux load averages, latency bands, network traffic, and managed systemd service health for the Agent, Xray, and port-forwarding units; TCP port-forwarding rules also get a local listener probe, so an active systemd unit with no reachable listening socket is reported as unhealthy while UDP rules stay on systemd-only checks; host-level quota or expiry guardrails disable managed Xray/port-forwarding units, later recover only units previously stopped by that guardrail and still present in the managed unit inventory, and report `hostGuardrailStoppedUnits` / `hostGuardrailRestoredUnits` evidence; managed-host details surface the load, latency, service-health, liveness state, and guardrail stopped/restored unit evidence, and Agent offline state, red high-latency samples, plus required service failures enter system alerts instead of requiring operators to inspect host files
  - When the Master is temporarily unavailable, the Agent runtime queues heartbeat, telemetry, log, ACK, and result events locally for retry. The local pending queue keeps 1000 events by default, pruning routine heartbeat/telemetry before command ACK/result evidence, and the runner rotates local `agent.log` at 5 MiB with 3 backups by default. Operators can tune these local bounds with `OU_AGENT_MAX_PENDING_EVENTS`, `OU_AGENT_LOG_MAX_BYTES`, and `OU_AGENT_LOG_BACKUP_COUNT`.
  - Agent install-token redemption into a runtime credential appends an `agent.credential.issued` audit-chain event containing only sanitized credential summaries and registration metadata, never raw token material or token hashes; `ou-ui doctor` reports static Agent token JSON validity and credential counts without printing tokens
  - the mock control plane now mirrors the service-backed registration boundary: registration matches the full install-token digest internally, forged tokens that only share the public `tokenPrefix` are rejected, and credential lists plus audit records still expose sanitized summaries only
  - managed-host delete tasks must converge through a successful Agent result; once the delete command succeeds, the service revokes every active runtime credential for that Agent in the same transaction and appends `agent.credential.revoked` audit evidence so deleted Agents cannot keep authenticating with old tokens
  - Agent install/runtime tokens, Agent IDs, and frontend-generated customer-node UUID/password/Reality short IDs now use Web Crypto / Node CSPRNG only; if no secure random source is available, generation fails instead of falling back to `Math.random`
  - operator bearer authentication failures on protected REST, SSE, and Prometheus routes return `401 unauthorized` promptly and append sanitized `audit.denied` evidence without bearer tokens; repeated failures from the same source are throttled by a default 60-second / 20-failure window, return `429 operator_auth.rate_limited` after the limit, and append only one throttle audit entry per window; `ou-ui doctor` reports operator auth throttle window, failure-limit config health, backend bearer-token presence, stale frontend operator-token exposure, nginx session-gate / operator-token / Agent bearer proxy wiring, and deployed static-bundle scans for known operator secrets before backend startup without printing tokens; sqlite-backed denied-audit writes read the previous audit hash through the same transaction so auth failures cannot self-block on the repository queue
  - `/api/v1` mutations authenticated by an HttpOnly operator session must include the server-issued `X-CSRF-Token`; bearer-token automation requests without a session cookie and `/agent/v1/*` Agent requests do not require CSRF
  - operator sessions are recorded server-side, readable through protected `/api/v1/operator-sessions`, and revocable through `/api/v1/operator-sessions/{sessionId}/revoke`; `ou-ui doctor` reports operator session completeness, secret presence, TTL health, and actor/group/resource identity bindings without printing the secret; revoked or logged-out cookies are denied on subsequent protected requests and leave audit evidence
  - the Security Policy workspace now shows sanitized Agent install/runtime credential inventory with `tokenPrefix`, purpose, status, session, and audit metadata only; it never renders raw tokens or `tokenHash`, and active runtime credentials can be revoked or rotated from the panel with refreshed read models and audit-chain evidence
  - audit repository writes now enforce append-only IDs: duplicate `auditLog.id` inserts are rejected, and file-backed state loading rejects duplicate audit IDs so restarted services cannot overwrite or disguise previous audit events
  - `/api/v1/audit-logs:verify` verifies the current persisted audit chain and also accepts exported audit log arrays for offline chain-integrity verification; when `OU_UI_EXTERNAL_ARCHIVE_DIRECTORY` is configured, every newly inserted audit log also appends a sanitized `hash` / `prevHash` / action / result anchor to `audit-anchors.jsonl` in that directory so operators can compare audit-chain heads outside the control-plane state store
  - the installer-generated Nginx panel proxy keeps `/events/v1/*` unbuffered and explicitly returns `text/event-stream`, so browsers and reverse proxies treat control-plane events as SSE instead of regular HTML
  - runtime apply commands hash the canonical inline artifact JSON, and the Agent verifies checksum plus `sig-v1` digest before taking a local snapshot, running preflight, or writing runtime files
  - runtime preflight read models cover artifact integrity, config schema, port conflicts, runtime dependency availability, and rollback snapshots; failed Agent results mark the matching check and retain failed health summaries
  - successful Agent results must report the command's expected `appliedConfigRevision`; the Master converts missing or mismatched revisions into failed results and marks result verification failed
  - when a runtime apply fails its post-apply health check, the Master creates a system actor `agent.rollback` task from the failed command's `snapshotBeforeId`, dispatches it to the same Agent, and records `rollbackTaskId` on the failed source task; that failure now derives a `runtime.apply_health_failed` system alert with notification, metrics, and lifecycle evidence, and a newer successful Agent-result proof apply or rollback for the same target resolves it; checksum, schema, and other preflight-style failures are marked failed without triggering health rollback
  - Agent ACK/result/log events must match the command outbox record across `commandId`, `taskId`, and `agentId`; mismatched events return `agent_event.command_task_mismatch`, do not update Agent events or outbox state, and count as non-retryable `rejected` items in multi-event `/agent/v1/events` batches; every runtime task that emits an Agent command must converge through Agent result events instead of manual task success transitions
  - when a reconnecting Agent poll includes `lastSeenCommandSeq`, the Master immediately replays same-`sessionId` dispatched commands that are still unacknowledged and whose `seq` is newer than the Agent reports seeing, without waiting for lease expiry; acknowledged or terminal commands are not replayed by this path
  - port forwarding read models show a binding as allocated only after every target Agent reports a successful, revision-verified result; Agent-reported port binding conflicts project the rule and binding as conflict, and Agent telemetry updates traffic and quota counters only
  - Agent port-forwarding apply/remove clears stale TCP and UDP systemd units for the service before rebuilding the latest protocol set, so editing a rule from `tcp+udp` down to one protocol or deleting it does not leave old forwarding services running
  - port-forwarding rule `rateLimitMode` / `rateLimitDirection` fields are included in runtime artifacts; the Agent maps them to GOST `limiter.in` / `limiter.out` for one-way ingress, one-way egress, and bi-directional rate limits, while old tasks without the new fields keep the bi-directional default
  - port-forwarding rules now support explicit pause/resume flows: `forward.pause` keeps the rule in the control-plane read model while requiring the Agent to stop the live runtime service and project the binding as paused, and `forward.resume` reapplies that same rule configuration
  - managed-host and port-forwarding traffic read models compute UTC monthly billing windows from `monthlyResetDay`; Agents report `trafficBillingPeriod`, the Master accepts only current-period samples, and snapshot reads reset stale period usage while appending host, forwarding, and Xray client counters into the traffic rollup read model; the dashboard aggregates those real history samples by managed host, port-forwarding rule, and customer node, can export the selected dimension as a JSONL diagnostics file, and its traffic history retention panel surfaces the runtime default, control-plane override, and effective policy while allowing operators to save `maxAgeDays` / `maxRecordsPerScope` overrides; `ou-ui doctor` reports traffic-history retention days and per-scope max-record config health before backend startup; `GET/PATCH /api/v1/traffic-rollup-retention-policy` persists those overrides, audits `traffic.rollup_retention.updated`, and applies pruning to subsequent telemetry writes; raw rollups removed by retention pruning are compacted into UTC-day buckets grouped by dimension, Agent, subject, and billing period, protected `/api/v1/traffic-rollup-compactions` plus `/api/v1/traffic-rollup-compactions:export` expose those compressed history records, and the dashboard shows the selected dimension's archive bucket count, raw sample count, metered total, latest archive time, and direct JSONL archive export; when `OU_UI_EXTERNAL_ARCHIVE_DIRECTORY` is configured, newly produced traffic compaction buckets are also appended to `traffic-rollup-compactions.jsonl` in that external archive directory; retained rollup totals, per-dimension counts, earliest/latest sample timestamps, cumulative metered bytes, compacted archive bucket counts, represented raw sample counts, earliest/latest archive bucket timestamps, and archive metered bytes are exposed through `/api/v1/observability-metrics` and `/metrics` for traffic-history storage pressure monitoring; the host read model derives offline state from heartbeat/telemetry age and sampling-gap plus red high-latency state from the expected sampling interval and probe thresholds, then routes those alerts to managed-host cards, the dashboard, and `/events/v1/system-alerts`
  - managed-host manual traffic calibration participates in server-side monthly usage derivation: when compatibility telemetry reports only monthly ingress/egress counters without an explicit total, the Master adds the manual calibration to the current-window usage according to both, single, ingress-only, or egress-only accounting; quota policies never under-report below the manual calibration, and quota reset replay writes the derived monthly total back into the telemetry payload
  - Xray customer-node artifacts carry client traffic limits, manual usage calibration, and monthly reset days; Agents collect client uplink/downlink through Xray StatsService and report `xrayClientCounters` for Master-side customer-node usage projection; when StatsService is temporarily unavailable, Agents still report `source: xray-guardrail` policy samples so the Master updates quota/expiry state without overwriting the last valid traffic counters
  - `/api/v1/quota-policies` is no longer a static seed-only view: both the service-backed and mock adapters aggregate live quota state from managed hosts, customer nodes, subscription users, forwarding accounts, forwarding links, and forwarding rules, and the security workspace can inspect the current billing-window usage, billing direction, reset day, and disable reason by scope
  - `/api/v1/customers` now derives a decoupled customer directory from customer nodes, subscription identities, and port-forwarding owners instead of static customer seeds; same-name customers are deduped across sources, and total usage is calculated as `max(customer-node usage, subscription usage) + forwarding usage`; the frontend Customer Management page independently shows the directory, sources, resource counts, quota state, and latest activity
  - protected `POST /api/v1/quota-policies/{quotaPolicyId}/reset` creates a real `quota.reset` task with before/after audit snapshots and reset baselines for later Agent telemetry and subscription-user public output, so pre-reset traffic is not counted again after recovery
  - forward-rule, forwarding-account, and forwarding-link quotas now create system actor `forward.pause` tasks when they enter an exceeded state and reuse the existing Agent apply/outbox chain; when the corresponding quota recovers, the Master creates `forward.resume` so forwarding quota disable and recovery both leave task, audit, and replay evidence
  - Xray Reality customer nodes separate server-side `privateKey/target/serverNames/shortIds` from client subscription `pbk/fp/sid` parameters; UI preview, API metadata, runtime artifacts, and share links now use the same field semantics
  - Local Xray VLESS public subscription URIs use the selected client's `flow`, so multi-client inbounds cannot overwrite a customer's share link with an inbound-level fallback value
  - Public Sing-box subscriptions emit VLESS `flow`, Reality `public_key/short_id`, uTLS fingerprint, and WS/gRPC/HTTPUpgrade transport fields without exposing server-side Reality private keys
  - deleting the last Xray customer node stops and removes `ou-ui-xray.service`, and the removed systemd unit is recorded in local revision changed files so runtime convergence and rollback evidence stay aligned
  - customer-node Xray runtime read models only project protocols that can currently be compiled and deployed: VLESS, VMess, Trojan, and Shadowsocks; unsupported explicit protocol requests do not create fake customer nodes
  - customer subscription read models and public subscription responses aggregate current usage and generated node counts from the selected local Xray clients; when runtime-backed customer nodes match, static `usedTrafficGb` / `generatedNodeCount` task metadata is only a fallback; exhausted subscription-user `user:*` quotas now block public downloads with `subscription.quota_exceeded`, and after reset the public `subscription-userinfo` traffic headers are recalculated from the reset baseline
  - subscription bundle read models are projected from current external sources, synced inventory nodes, and export profiles, so bundle health, source status, and generated node counts no longer depend on static seed bundles
  - external source sync only fetches `http` / `https` subscription URLs, blocks localhost and private/local IP literals plus hostnames that resolve to private/local IPs before fetch, pins the default production request to the verified public DNS address while preserving the original Host / HTTPS SNI, can restrict outbound source hosts with `OU_UI_SUBSCRIPTION_SOURCE_EGRESS_ALLOWLIST`, and supports per-source remote request timeouts plus response body limits; `ou-ui doctor` reports the subscription-source allowlist, provider-host concurrency limit, and global daily sync budget health; timeouts, oversize responses, unsupported protocols, allowlist misses, and blocked targets become sync failure state and audit-chain entries
  - external source sync writes a non-sensitive persisted sync lease before remote reads; concurrent instances syncing the same source return `subscription_source.rate_limited` through the lease / refresh interval instead of duplicating remote fetches
  - external source sync also counts unexpired persisted sync leases per provider host and defaults to at most two concurrent fetches for the same upstream host; operators can tune this with `OU_UI_SUBSCRIPTION_SOURCE_PROVIDER_MAX_CONCURRENT_FETCHES_PER_HOST`
  - external source sync detects cross-source duplicate nodes with the current dedupe policy, marks the source as warning, and surfaces non-sensitive sync warnings in the source table
  - external source sync success, warning, and failure outcomes are appended to the audit hash chain with before/after source state, node counts, and warning codes
  - subscription rules can filter nodes by protocol, region, source, managed host, runtime status, customer, and traffic conditions; the identity dialog exposes a dedicated Traffic Condition control that composes `traffic:*` rules, and local Xray nodes carry customer, host, status, used-traffic, and quota metadata for rule matching
  - external subscription sync parses provider `subscription-userinfo` traffic headers, persists upload, download, total quota, and expiry snapshots on the subscription source read model, and surfaces them in the source table
  - when an Xray customer-node client exceeds its monthly quota or expires, the Agent filters that client out of the runtime inbound, rebuilds the Xray config, and reports `runtimeDisabledByPolicy` with the guardrail reason; when the Agent later reports policy recovery, the Master re-enables client read models that were disabled by runtime guardrails
  - high-risk tasks require explicit `riskConfirmation` whose `operation` and `targetId` match the task body; deletes, rollbacks, runtime reload, quota reset, and permission revoke requests are denied and written as `audit.denied` when confirmation is missing or mismatched
  - permission checks ignore revoked, expired, or invalid-expiry grants; `permission.grant` and `permission.revoke` authorization is scoped by both `permissionChange.resourceType` and `resourceId`, so Agent delegation cannot be reused for forwarding, subscription, or other cross-type escalation
- **Mock and HTTP adapter split**
  - the frontend can run against mock data for UI iteration
  - or target the service-backed HTTP control plane
- **Automated verification**
  - Vitest
  - ESLint
  - TypeScript typecheck
  - production Vite build

## One-Click Master Deployment

The operator-facing deployment entrypoint is:

```bash
sudo bash -c 'bash <(curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/scripts/install-master.sh)'
```

If you are already running as `root`, use:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/scripts/install-master.sh)
```

After installation, use the management shortcut at any time:

```bash
ou-ui menu
ou-ui credentials
ou-ui restart
ou-ui update
ou-ui fix
ou-ui repair-nginx
ou-ui reconfigure
ou-ui doctor
ou-ui smoke
ou-ui browser-smoke
ou-ui acceptance
ou-ui acceptance-verify /var/lib/ou-ui-next/acceptance/20260606T120000Z
ou-ui final-acceptance --telegram-admin-chat-id 123456
ou-ui production-release-acceptance --telegram-admin-chat-id 123456 --include-archive-smoke --archive-provider-evidence /root/ou-ui-receipts/archive-provider-evidence.json --timestamp-evidence /root/ou-ui-receipts/timestamp-evidence.json --install-evidence /root/ou-ui-receipts/clean-install-summary.json --agent-evidence /var/lib/ou-agent/acceptance/20260606T120000Z
ou-ui backup-state
ou-ui restore-state /path/to/control-plane-backup.sqlite
ou-ui reset-state
ou-ui uninstall
```

The shortest entrypoint is `ou`: running `ou` with no arguments opens the interactive maintenance menu.
If your server was installed with an older build and does not have `ou` / `ou-ui` yet, refresh the shortcuts first, then run `ou f --force` to repair the frontend, nginx surface, and stale state:

```bash
sudo bash -c 'bash <(curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/scripts/install-master.sh) repair-cli'
```

Status checks are split intentionally: `ou s` shows the systemd service state, while `ou d` runs the full installation doctor for nginx, Basic Auth, panel URL, service state, systemd unit hardening, runtime filesystem permissions, the current control-plane storage path, source commit, and deployed frontend build commit.
Before uninstalling, back up anything you need to keep. `ou x` / `ou-ui uninstall` removes the install directory, config directory, state directory, web root, nginx site, and systemd service. If install or update created the low-memory build swap, uninstall first disables that swap, removes the matching `fstab` entry, and then deletes the state directory so the host is not left with system-level residue.
`OU_UI_LOCAL_SOURCE_DIR` is intended for development/debug deployments only. Production updates should use the GitHub install path so `ou u` / `ou f` can pull the latest remote release directly.
Managed hosts also get an `ou-agent` shortcut after enrollment: `ou-agent` opens its menu, `ou-agent status` checks the service state, `ou-agent doctor` / `ou-agent d` runs local diagnostics without printing the runtime token, `ou-agent qa` writes a local Agent acceptance evidence bundle with doctor output, service status, a redacted log tail, a sanitized `runtime-summary.json`, and a SHA-256 manifest, `ou-agent qv <bundle directory or manifest.json>` verifies bundle integrity, `ou-agent qv --require-runtime-evidence <bundle directory or manifest.json>` also enforces a non-empty `manifest.bundleDirectory` plus archived `runtime-summary.json` evidence for Xray inbounds, port-forwarding services, pending queue, and guardrail health, `ou-agent qv --require-final-summary <bundle directory or manifest.json>` rechecks that `final-acceptance-summary.json` has a valid UTC `createdAt`, a non-empty `bundleDirectory` matching `manifest.bundleDirectory`, the `final-acceptance-verify.txt` path/size/SHA-256, and strict gate markers written by `ou-agent qf`, `ou-agent qvf <bundle directory or manifest.json>` rechecks Agent runtime and final-summary strict gates in one command, `ou-agent qf` writes an Agent evidence bundle and immediately runs strict runtime verification, saving `final-acceptance-verify.txt` and `final-acceptance-summary.json`, `ou-agent update` updates the Agent runtime from GitHub without re-registering or consuming a new install token, and `ou-agent uninstall` removes the host Agent. `runtime-summary.json` records only runtime file status, module runtime state, Xray inbound counts, port-forwarding service counts, guardrail counts, and pending-event counts; it does not archive raw artifacts, client UUIDs/emails, forwarding target addresses, or Agent tokens.

Short aliases are installed automatically: `ou p` prints panel information, `ou c` prints login credentials, `ou rc` rotates operator login credentials, `ou rs` restarts the service, `ou u` updates from GitHub, `ou b` backs up control-plane state, `ou f` runs the one-click repair flow, `ou r` resets control-plane state, `ou m` changes port/certificate settings, `ou d` runs diagnostics, `ou sm` runs the HTTP production smoke test, `ou bs` runs the real browser smoke test, `ou ns` runs the real Telegram notification smoke test, `ou ws` runs the real webhook smoke test, `ou as` runs the real external archive smoke test, `ou ape` writes archive provider evidence, `ou te` writes third-party timestamp evidence, `ou cie` writes clean-install evidence, `ou qa` writes an acceptance evidence bundle, `ou qv` verifies bundle integrity, `ou qf` runs final field acceptance, `ou qvf` rechecks a final field acceptance bundle in one command, `ou qvr` forces every production release gate, `ou qfa` runs the full production release acceptance orchestration, and `ou x` uninstalls the panel.

`ou-ui credentials` / `ou c` prints the full panel URL, username, and password. Appending `--help` / `-h` prints usage only, never reads or outputs login credentials, and other extra arguments are rejected to avoid accidental disclosure. Install, update, and repair self-checks now JSON-encode the login payload and pipe it to `curl` through stdin instead of interpolating the password into command-line arguments. `ou-ui rotate-credentials` / `ou rc` generates a new random operator username/password, updates the backend `scrypt:v1` hash, removes backend plaintext password compatibility, and invalidates existing browser sessions; use it immediately when `ou d` reports default or weak credentials on an upgraded install. `ou-ui doctor` / `ou d` checks nginx, Basic Auth, service state, systemd unit hardening, runtime filesystem permissions, the current control-plane storage path, browser smoke script/Playwright/Chromium readiness, operator credential strength, source commit, and deployed frontend build commit. `ou-ui backup-state` / `ou b` creates a backup of the current control-plane store, defaulting to the control-plane backup directory unless you pass an explicit output path, and writes a `.manifest.json` sidecar with the backup SHA-256, size, storage mode, creation time, and source commit. `ou-ui restore-state <backup-path>` validates the manifest SHA-256 and size when present, validates a SQLite backup, creates a pre-restore snapshot, stops the service, and switches the live store to that backup; append `yes` to skip the interactive confirmation. `ou-ui fix` / `ou f` pulls the latest GitHub source, rebuilds the frontend, refreshes shortcuts, restarts services, rewrites the OU-UI nginx panel site, and verifies the login page, Basic Auth surface, and frontend build fingerprint. When upgrading older installs whose static files were refreshed by the current build but still lack `build-info.json`, the same update writes the missing fingerprint before the strict self-check continues. If a fresh install still shows stale demo data, run `ou fix --force` to clear the old control-plane state automatically. `ou-ui repair-nginx` rewrites the panel nginx config without rebuilding the frontend. `ou-ui reconfigure` / `ou m` reopens the installer to change the port, certificate, or nginx wiring while preserving the existing secure path, login credentials, operator token, session secret, and Agent bootstrap token. The installer also creates `ou-ui-next`, `ou-ui`, and `ouui` as equivalent shortcuts.

By default the installer pulls the `cshaizhihao/ou-ui-next` `main` branch from GitHub and builds it on the server. Users do not need to clone the repository first. Local source deployment is now an explicit development/debug path via `OU_UI_LOCAL_SOURCE_DIR=/path/to/ou-ui-next`.
Production installs now persist control-plane state in a SQLite database file by default; when an older deployment still has the legacy JSON state file, the installer preserves that source path and the backend imports it on the first SQLite boot. SQLite storage and maintenance commands validate `schema_version`, `state_format`, and the `control_plane_migrations` ledger before serving or validating state; older v1 SQLite stores are backfilled with the current migration ledger when opened by the backend or backed up by the SQLite tool, and restored legacy v1 backups get the ledger on the restored target database. The post-install management CLI also provides a local single-node backup/restore path with SHA-256 manifests. The underlying SQLite maintenance tool `scripts/control-plane-sqlite-tool.cjs backup` writes a `.manifest.json` sidecar directly, `validate` / `restore` verify the manifest schema, file size, and SHA-256 when that sidecar is present, and the manifest records the SQLite migration ledger, so operators can snapshot and verify the control plane before updates, repairs, or rollback work. The installer also configures `OU_UI_EXTERNAL_ARCHIVE_DIRECTORY` by default so retention-pruned Agent log summaries, traffic compaction buckets, and audit-chain anchors are appended to JSONL archive files outside the control-plane state store. Operators can configure one or more archive webhooks with `OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_URL` / `OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_URLS`, with `OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_TIMEOUT_MS`, `OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_BEARER_TOKEN`, and `OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_EGRESS_ALLOWLIST` controlling timeout, bearer auth, and allowed target hosts. Operators can also configure S3-compatible object storage with `OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ENDPOINT`, `OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_BUCKET`, `OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_REGION`, `OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_ACCESS_KEY_ID`, and `OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_SECRET_ACCESS_KEY`; `OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_PREFIX`, `OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_SESSION_TOKEN`, `OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_TIMEOUT_MS`, `OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_FORCE_PATH_STYLE`, `OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_EGRESS_ALLOWLIST`, `OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_MODE`, `OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_RETENTION_DAYS`, and `OU_UI_EXTERNAL_ARCHIVE_OBJECT_STORAGE_OBJECT_LOCK_LEGAL_HOLD` control object prefixes, STS tokens, timeouts, path-style or virtual-hosted-style addressing, allowed target hosts, and optional S3 Object Lock retention headers. File, webhook, and object-storage sinks can be combined; remote delivery blocks localhost/private/link-local/multicast targets and targets that resolve to those address ranges, records sanitized delivery logs, and still needs real provider acceptance evidence, provider-side immutable bucket/retention proof, and SIEM/warehouse-specific pipelines.

### Production Smoke Test

After a live install, use the generated management command to verify the real panel entrypoint, operator login, HttpOnly session, CSRF guard, protected API reads, SSE, and Prometheus proxy path:

```bash
sudo ou sm
```

To save live acceptance evidence, write a sanitized JSON report:

```bash
sudo ou sm --report /var/lib/ou-ui-next/acceptance/smoke-$(date -u +%Y%m%dT%H%M%SZ).json
```

The HTTP smoke report now includes a sanitized runtime acceptance summary with counts for Agents, Agent sessions, Xray inbounds, port-forwarding rules/ports, quotas, tasks, alerts, command dead letters, and audit health. It does not include Agent IDs, session IDs, forwarding IDs, tokens, or passwords. For final live Agent/Xray/forwarding acceptance, add the hard gate:

```bash
sudo ou sm --require-runtime-evidence --report /var/lib/ou-ui-next/acceptance/smoke-runtime-$(date -u +%Y%m%dT%H%M%SZ).json
```

That mode requires at least one online or degraded-visible Agent session, at least one Xray inbound, at least one port-forwarding rule/port, and no critical system alerts or command dead letters. If the gate is not met, the smoke run fails and writes the failure reasons into the report.

To validate the real browser workflow, run the browser smoke test. It uses the installed panel URL and root-only credentials file, then drives a headless browser through login, key page navigation, screenshots, and logout. Reports do not include the login password, cookies, CSRF token, or bearer tokens:

```bash
sudo ou bs --report /var/lib/ou-ui-next/acceptance/browser-smoke-$(date -u +%Y%m%dT%H%M%SZ).json --screenshot-dir /var/lib/ou-ui-next/acceptance/browser-screenshots
```

If the deployment host reports missing Playwright browser binaries or system dependencies, run `sudo npx playwright install chromium` from the install directory and retry. You can also run the same script manually:

```bash
cd /opt/ou-ui-next/current
sudo env OU_UI_BROWSER_SMOKE_BASE_URL="https://your-domain:8443/secure-path/" npm run smoke:browser
```

To validate the real external notification path, run the notification smoke test. It uses the installed panel URL and root-only credentials file, reads Telegram settings, and calls the test-notification API to send one real Telegram message. You must explicitly choose an admin chat or an existing binding; reports do not include the login password, cookies, CSRF token, bot token, chat ID, or binding ID:

```bash
sudo ou ns --telegram-admin-chat-id 123456 --report /var/lib/ou-ui-next/acceptance/notification-smoke-$(date -u +%Y%m%dT%H%M%SZ).json
sudo ou ns --telegram-binding-id telegram-binding-001 --language en
```

You can also run the same script manually:

```bash
cd /opt/ou-ui-next/current
sudo env OU_UI_NOTIFICATION_SMOKE_BASE_URL="https://your-domain:8443/secure-path/" npm run smoke:notifications -- --telegram-admin-chat-id 123456
```

To validate system-alert webhooks or other external notification webhook endpoints, run the webhook smoke test. Installed `ou ws` reads `OU_UI_SYSTEM_ALERT_WEBHOOK_URL` / `OU_UI_SYSTEM_ALERT_WEBHOOK_URLS` and the bearer token from the backend env by default, then sends one sanitized test JSON payload to each target. Reports do not include bearer tokens, full URL paths, or query strings:

```bash
sudo ou ws --report /var/lib/ou-ui-next/acceptance/webhook-smoke-$(date -u +%Y%m%dT%H%M%SZ).json
sudo ou ws --url https://hooks.example.com/ou-ui-alerts --report /var/lib/ou-ui-next/acceptance/webhook-smoke.json
```

You can also run the same script manually:

```bash
cd /opt/ou-ui-next/current
sudo env OU_UI_WEBHOOK_SMOKE_ENV_FILE=/etc/ou-ui-next/master.env npm run smoke:webhooks -- --report /var/lib/ou-ui-next/acceptance/webhook-smoke.json
```

To validate a real external archive provider, run the archive smoke test. Installed `ou as` reads `OU_UI_EXTERNAL_ARCHIVE_DIRECTORY`, `OU_UI_EXTERNAL_ARCHIVE_WEBHOOK_URL(S)`, and S3-compatible object-storage settings from the backend env by default, then writes one sanitized audit anchor, one Agent log archive summary, and one traffic compaction bucket to the configured sinks. This command performs real writes to the local archive directory, external archive webhooks, and object storage; reports do not include webhook tokens, object-storage credentials, full URL paths, or query strings. When optional Object Lock is configured, the report records only the mode, retentionDays, and legalHoldEnabled summary:

```bash
sudo ou as --report /var/lib/ou-ui-next/acceptance/archive-smoke-$(date -u +%Y%m%dT%H%M%SZ).json
```

You can also run the same script manually:

```bash
cd /opt/ou-ui-next/current
sudo env OU_UI_ARCHIVE_SMOKE_ENV_FILE=/etc/ou-ui-next/master.env npm run smoke:archive -- --report /var/lib/ou-ui-next/acceptance/archive-smoke.json
```

Archive smoke is not run by `ou qa` / `ou qf` by default, so routine evidence bundles do not create external provider writes. To include external archive field delivery in the same evidence bundle, pass `--include-archive-smoke` explicitly and keep the provider-side receipt evidence.

To collect the full production acceptance evidence bundle, including `ou d` diagnostics, HTTP smoke output, browser smoke output, notification/webhook/archive smoke skipped or executed evidence, optional external provider receipt attachments, optional clean-server install evidence attachments, optional Agent host evidence attachments, sanitized JSON reports, browser screenshots, and a manifest with file sizes/SHA-256 hashes:

```bash
sudo ou qa
```

For live Agent/Xray/forwarding field acceptance, use:

```bash
sudo ou qa --require-runtime-evidence
```

By default, `ou qa` does not send Telegram messages; it writes `notification-smoke.txt` and `notification-smoke-report.json` showing that notification smoke was skipped. To include a real Telegram notification in the same evidence bundle, opt in and provide the target explicitly:

```bash
sudo ou qa --include-notification-smoke --telegram-admin-chat-id 123456
sudo ou qa --include-notification-smoke --telegram-binding-id telegram-binding-001 --notification-language en
```

By default, `ou qa` also does not deliver webhook payloads; it writes `webhook-smoke.txt` and `webhook-smoke-report.json` showing that webhook smoke was skipped. To include a real external webhook delivery in the same evidence bundle, opt in explicitly. Without `--webhook-url` / `--webhook-urls`, it reads the installed backend env:

```bash
sudo ou qa --include-webhook-smoke
sudo ou qa --include-webhook-smoke --webhook-url https://hooks.example.com/ou-ui-alerts --webhook-bearer-token-file /run/secrets/ou-ui-webhook-token
```

By default, `ou qa` also does not write to external archive providers; it writes `archive-smoke.txt` and `archive-smoke-report.json` showing that archive smoke was skipped. To include real external archive delivery in the same evidence bundle, opt in explicitly:

```bash
sudo ou qa --include-archive-smoke
```

Provider-side delivery receipts, object-storage upload receipts, ticket exports, or screenshot-derived JSON/TXT evidence should be sanitized by the operator first and then attached explicitly. `ou qa` only copies these files, writes `external-receipts-manifest.json`, and records SHA-256 hashes; it does not redact arbitrary receipt file content:

```bash
sudo ou qa --external-receipt /root/ou-ui-receipts/provider-receipt.json
```

To make provider-side immutable storage evidence machine-enforced, use a sanitized JSON receipt with `schemaVersion: "ou-ui-next.archive-provider-evidence.v1"`: `status` must be `passed`, `objectStorage.deliveryStatus` must be `delivered`, and the receipt must record `bucket`, `objectCount`, `objectLock.mode`, `retentionDays` or `retentionUntil`, `legalHoldEnabled`, `bucketObjectLockEnabled=true`, and `retentionPolicyVerified=true`. Do not include access keys, secrets, tokens, passwords, full query-bearing URLs, or unsanitized screenshot text. The installed root-only CLI can generate this schema with `ou archive-provider-evidence` from a passed `archive-smoke-report.json` plus operator confirmations: it requires explicit `--object-storage-delivery-confirmed --bucket-object-lock-confirmed --retention-policy-confirmed`, writes `/var/lib/ou-ui-next/acceptance/archive-provider-evidence-<UTC>.json` by default, and records only URL origin, bucket, object count, and Object Lock/retention summaries. The `ou ape` menu path asks for each `yes` confirmation. The command helps field operators produce strict-gate-readable receipts, but it does not replace real provider-console/API evidence for immutable retention policy. Prefer `ou qa --archive-provider-evidence <file>` to attach it: the file is still recorded in `external-receipts-manifest.json`, and `ou qf` automatically enables both `--require-external-receipts` and `--require-archive-provider-evidence`.

```bash
sudo ou as --report /root/ou-ui-receipts/archive-smoke-report.json
sudo ou archive-provider-evidence --archive-smoke-report /root/ou-ui-receipts/archive-smoke-report.json --object-storage-delivery-confirmed --bucket-object-lock-confirmed --retention-policy-confirmed
sudo ou qa --archive-provider-evidence /root/ou-ui-receipts/archive-provider-evidence.json
```

To make third-party timestamp anchoring machine-enforced, have an external TSA / OpenTimestamps / equivalent service timestamp a sanitized artifact first, then use `ou timestamp-evidence` to generate a sanitized JSON summary with `schemaVersion: "ou-ui-next.timestamp-evidence.v1"`. It records only the anchored artifact basename, byte size, SHA-256, the third-party receipt basename, byte size, SHA-256, `timestampedAt`, optional `verifiedAt`, `verificationStatus=verified`, and explicit `thirdPartyTimestampConfirmed` / `receiptSanitized` / `verificationConfirmed` confirmations; it does not copy the receipt body. The command writes `/var/lib/ou-ui-next/acceptance/timestamp-evidence-<UTC>.json` by default, and the `ou te` menu path asks for each `yes` confirmation. Prefer timestamping `archive-provider-evidence.json` or another sanitized release artifact, then attach the summary with `ou qa --timestamp-evidence <file>`; `ou qf` automatically enables both `--require-external-receipts` and `--require-timestamp-evidence`.

```bash
sudo ou timestamp-evidence --artifact /root/ou-ui-receipts/archive-provider-evidence.json --receipt /root/ou-ui-receipts/archive-provider-evidence.tsr.redacted --timestamped-at 2026-06-07T12:00:00Z --third-party-timestamp-confirmed --receipt-sanitized --verification-confirmed
sudo ou qa --timestamp-evidence /root/ou-ui-receipts/timestamp-evidence.json
sudo ou qv --require-timestamp-evidence /var/lib/ou-ui-next/acceptance/20260606T120000Z
```

Clean-server install transcripts, install summaries, and ticket-exported TXT/JSON evidence should also be sanitized by the operator before being attached. `ou qa` only copies these files, writes `install-evidence-manifest.json`, and records SHA-256 hashes; it does not redact arbitrary install logs. To make this machine-enforced, include at least one sanitized JSON summary with `schemaVersion: "ou-ui-next.clean-install-evidence.v1"`: `status` must be `passed`, `installation.mode` must be `fresh`, `installation.exitCode` or `installerExitCode` must be `0`, `environment.cleanServer=true`, `environment.preExistingOuUi=false` or `preExistingOuUiNext=false`, and `results.managementCliInstalled=true`, `results.serviceActive=true`, plus `results.panelReachable=true` or `frontendLoginPageVerified=true`. Do not include tokens, passwords, cookies, CSRF values, bearer secrets, URLs with query strings, or unsanitized paths. The installed root-only CLI can generate this sanitized summary with `ou clean-install-evidence`: it requires explicit `--clean-server-confirmed --fresh-install-confirmed`, writes `/var/lib/ou-ui-next/acceptance/clean-install-evidence-<UTC>.json` by default, and optional `--transcript <path>` records only the sanitized transcript basename, byte size, and SHA-256 without copying the transcript body. The `ou cie` menu path asks for two `yes` confirmations before generating it. The command checks the backend service, management CLI, and panel entrypoint, or requires operator-provided external-evidence confirmation flags; it helps field operators produce strict-gate-readable evidence, but it does not replace a real clean-server install. Then enforce it with `ou qv --require-clean-install-evidence` or by passing `--install-evidence` during final acceptance.

```bash
sudo ou clean-install-evidence --clean-server-confirmed --fresh-install-confirmed
sudo ou clean-install-evidence --clean-server-confirmed --fresh-install-confirmed --transcript /root/ou-ui-receipts/install-transcript.redacted.txt
sudo ou qa --install-evidence /root/ou-ui-receipts/clean-install-summary.json
sudo ou qv --require-clean-install-evidence /var/lib/ou-ui-next/acceptance/20260606T120000Z
```

Agent host evidence bundles produced by `ou-agent qa` or `ou-agent qf` can also be attached explicitly to the Master acceptance bundle. `ou qa` copies only the Agent bundle `manifest.json`, `runtime-summary.json`, and optional `final-acceptance-summary.json` / `final-acceptance-verify.txt`, writes `agent-evidence-manifest.json`, and records SHA-256 hashes. Ordinary `--require-agent-evidence` still rechecks `ou-agent qa` runtime evidence and requires the attached Agent manifest to have a non-empty `bundleDirectory`, `serviceStatus=0`, and `runtimeSummaryStatus=0`; production release verification through `qvr/qfa` additionally requires the Agent final host acceptance summary and transcript written by `ou-agent qf`:

```bash
sudo ou qa --agent-evidence /var/lib/ou-agent/acceptance/20260606T120000Z
```

`ou qa` fixes the target panel URL, root-only credentials file, backend env file, bundle-local `smoke-report.json`, `browser-smoke-report.json`, `browser-screenshots/`, `notification-smoke-report.json`, `webhook-smoke-report.json`, `archive-smoke-report.json`, `external-receipts-manifest.json`, `install-evidence-manifest.json`, and `agent-evidence-manifest.json`, so it rejects `--report`, `--base-url`, `--credentials-file`, `--screenshot-dir`, and `--env-file`; `--timeout-ms`, `--insecure-tls`, `--skip-csrf-probe`, `--require-runtime-evidence`, `--include-notification-smoke`, `--telegram-admin-chat-id`, `--telegram-binding-id`, `--notification-language`, `--include-webhook-smoke`, `--webhook-url`, `--webhook-urls`, `--webhook-bearer-token`, `--webhook-bearer-token-file`, `--allow-local-webhook`, `--include-archive-smoke`, `--external-receipt`, `--archive-provider-evidence`, `--timestamp-evidence`, `--install-evidence`, `--require-archive-provider-evidence`, `--require-timestamp-evidence`, `--require-clean-install-evidence`, and `--agent-evidence` can still be passed through, and low-resource servers can explicitly use `--skip-browser-smoke`. The generated `manifest.json` records the path, byte size, and SHA-256 for `doctor.txt`, `smoke.txt`, `smoke-report.json`, `browser-smoke.txt`, `browser-smoke-report.json`, `browser-screenshots.tar.gz`, `notification-smoke.txt`, `notification-smoke-report.json`, `webhook-smoke.txt`, `webhook-smoke-report.json`, `archive-smoke.txt`, `archive-smoke-report.json`, `external-receipts-manifest.json`, `install-evidence-manifest.json`, and `agent-evidence-manifest.json`; the receipt manifest records each provider / timestamp attachment's `external-receipts/` relative path, byte size, and SHA-256, the install evidence manifest records each attachment's `install-evidence/` relative path, byte size, and SHA-256, and the Agent evidence manifest records each attached `agent-evidence/` directory plus its key file hashes so archived live evidence can be checked for later changes.

After archiving or transferring the bundle, verify its integrity:

```bash
sudo ou qv /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qv /var/lib/ou-ui-next/acceptance/20260606T120000Z/manifest.json
```

By default, `ou qv` verifies only the file sizes and SHA-256 hashes recorded in the manifest, keeping older bundles compatible. For field acceptance, add strict gates so the archived bundle must prove a non-empty `manifest.bundleDirectory`, runtime evidence, browser smoke, archived browser screenshots, notification smoke, and webhook smoke actually passed. If the bundle was created with `ou qa --include-archive-smoke`, add `--require-archive-smoke` to require the real external archive delivery evidence as well. If the bundle carries provider-side receipt files, add `--require-external-receipts` to require at least one receipt attachment with matching hashes. If a receipt uses the `ou-ui-next.archive-provider-evidence.v1` sanitized JSON schema, add `--require-archive-provider-evidence` to require at least one receipt proving object-storage delivery plus provider-side Object Lock/retention policy. If a receipt uses the `ou-ui-next.timestamp-evidence.v1` sanitized JSON schema, add `--require-timestamp-evidence` to require at least one receipt proving a third-party timestamp receipt was sanitized, verified, and recorded with valid hashes. If the bundle carries clean-server install evidence, add `--require-clean-install-evidence` to require at least one install summary matching `ou-ui-next.clean-install-evidence.v1` with matching hashes. If the bundle carries Agent host evidence, add `--require-agent-evidence` to require at least one Agent bundle with a non-empty Agent `manifest.bundleDirectory`, `serviceStatus=0`, `runtimeSummaryStatus=0`, matching hashes, and a `runtime-summary.json` that proves Xray inbounds, port-forwarding services, an empty pending queue, and healthy guardrail evidence. To treat Agent host evidence as production release proof, add `--require-agent-final-summary`; it requires the Agent bundle to include `final-acceptance-summary.json` with a valid UTC `createdAt`, a non-empty `bundleDirectory` matching the Agent `manifest.bundleDirectory`, plus the verification transcript produced by `ou-agent qf`, and rechecks the manifest/transcript paths, sizes, and SHA-256 values recorded there. If the bundle was produced by `ou qf`, add `--require-final-summary` to recheck that the Master `final-acceptance-summary.json` has a valid UTC `createdAt`, a non-empty `bundleDirectory` matching `manifest.bundleDirectory`, plus the strict verifier transcript path/size/SHA-256. If the bundle was produced by `ou qfa`, add `--require-release-summary` to recheck that `release-acceptance-summary.json` has a valid UTC `createdAt`, a non-empty `bundleDirectory` matching `manifest.bundleDirectory` or the current bundle directory, the release verifier transcript path/size/SHA-256, and promote every release gate marker back into content verification for the current run:

```bash
sudo ou qv --require-runtime-evidence --require-browser-smoke /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qv --require-runtime-evidence --require-browser-smoke --require-notification-smoke --require-webhook-smoke /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qv --require-archive-smoke /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qv --require-external-receipts /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qv --require-archive-provider-evidence /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qv --require-timestamp-evidence /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qv --require-clean-install-evidence /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qv --require-agent-evidence /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qv --require-agent-final-summary /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qv --require-final-summary /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qv --require-release-summary /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qvf /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qvr /var/lib/ou-ui-next/acceptance/20260606T120000Z
sudo ou qvr --write-summary /var/lib/ou-ui-next/acceptance/20260606T120000Z
```

You can also run the final field acceptance shortcut directly. `ou qf` writes the evidence bundle, then immediately runs strict `ou qv --require-runtime-evidence --require-browser-smoke --require-notification-smoke --require-webhook-smoke`, saving the verification transcript as `final-acceptance-verify.txt` inside the bundle and a machine-readable `final-acceptance-summary.json` with the manifest and transcript path, size, and SHA-256, which can later be rechecked with `ou qvf <bundle>` across runtime, browser, notification, webhook, and final-summary strict gates. If the final summary records archive smoke, external receipts, provider evidence, timestamp evidence, clean install, Agent evidence, or Agent final-summary gates as true, `qvf` automatically promotes those records to strict requirements for the current run, rechecks the corresponding archived evidence, and requires the final-summary `createdAt` to be valid UTC time, `bundleDirectory` to match `manifest.bundleDirectory`, and summary file paths to point at the original manifest bundle or the current archived bundle instead of trusting only the transcript marker. To treat an archived bundle as proof for a production release, use `ou qvr <bundle>`: it forces archive smoke, external receipts, provider evidence, timestamp evidence, clean install evidence, Agent runtime evidence, the Agent final host acceptance summary, and the Master final-summary gates; the Master final summary must also record the archive smoke, external receipt, provider evidence, timestamp evidence, clean install, Agent evidence, and Agent final-summary gates. If the archived bundle already contains `release-acceptance-summary.json`, `ou qvr` also rechecks the release summary and `release-acceptance-verify.txt`, requires the release-summary `createdAt` to be valid UTC time plus `bundleDirectory` to match `manifest.bundleDirectory` or the current bundle directory, and promotes every gate recorded in the release summary back into content verification. When a manual release verifier run needs persisted evidence, use `ou qvr --write-summary <bundle>` to write or overwrite those two release evidence files for either a passed or failed run; failed summaries keep `status=failed`, the current bundleDirectory, and the current transcript path/hash. To run production release acceptance directly in the field, use `ou qfa`: it requires explicit `--include-archive-smoke`, `--archive-provider-evidence`, `--timestamp-evidence`, `--install-evidence`, and `--agent-evidence`, preflights provider, timestamp, clean-install, and Agent evidence paths and content before smoke work starts, requires the Agent evidence to include the `ou-agent qf` final host acceptance summary, runs strict `qf` while writing the Agent final-summary gate into the Master transcript and `final-acceptance-summary.json`, then immediately runs `qvr` against the same bundle, saving the release verifier transcript as `release-acceptance-verify.txt` and the machine-readable release summary as `release-acceptance-summary.json`. `ou qf` remains the ordinary final field acceptance entry, `ou qvr` remains the archived-bundle release verifier, and `ou qfa` is the orchestration entry that prevents release acceptance from missing archive/provider/timestamp/clean-install/Agent evidence. `ou qf` automatically enables runtime, notification, and webhook evidence collection, does not trigger archive smoke by default, forbids `--skip-browser-smoke`, and requires an explicit Telegram test target. If final acceptance is run with `--include-archive-smoke`, `--external-receipt`, `--archive-provider-evidence`, `--timestamp-evidence`, `--require-archive-provider-evidence`, `--require-timestamp-evidence`, `--install-evidence`, `--require-clean-install-evidence`, or `--agent-evidence`, `qf` automatically adds the matching strict gates; `--archive-provider-evidence` enables both receipt hash verification and provider evidence schema verification, and `--timestamp-evidence` enables both receipt hash verification and timestamp evidence schema verification. `qfa` additionally requires the Agent final-summary gate on top of `--agent-evidence`. These optional gates are recorded in the final summary for later `ou qvf <bundle>` revalidation:

```bash
sudo ou qf --telegram-admin-chat-id 123456
sudo ou qf --telegram-binding-id telegram-binding-001 --notification-language en --webhook-url https://hooks.example.com/ou-ui-alerts
sudo ou qf --telegram-admin-chat-id 123456 --archive-provider-evidence /root/ou-ui-receipts/archive-provider-evidence.json
sudo ou qf --telegram-admin-chat-id 123456 --timestamp-evidence /root/ou-ui-receipts/timestamp-evidence.json
sudo ou qf --telegram-admin-chat-id 123456 --install-evidence /root/ou-ui-receipts/clean-install-summary.json
sudo ou qf --telegram-admin-chat-id 123456 --agent-evidence /var/lib/ou-agent/acceptance/20260606T120000Z
sudo ou qfa --telegram-admin-chat-id 123456 \
  --include-archive-smoke \
  --archive-provider-evidence /root/ou-ui-receipts/archive-provider-evidence.json \
  --timestamp-evidence /root/ou-ui-receipts/timestamp-evidence.json \
  --install-evidence /root/ou-ui-receipts/clean-install-summary.json \
  --agent-evidence /var/lib/ou-agent/acceptance/20260606T120000Z
```

`ou qfa` is only a strict orchestration entry. It does not create real provider-console/API, third-party timestamp, clean-server install, or Agent-host facts for the operator; those pieces of evidence still have to come from the live deployment and be sanitized first.

You can also run the same script manually from the installed source directory:

```bash
cd /opt/ou-ui-next/current
sudo env OU_UI_SMOKE_BASE_URL="https://your-domain:8443/secure-path/" npm run smoke:production
```

The script reads `/etc/ou-ui-next/credentials.env` by default and does not print passwords, cookies, CSRF tokens, or backend bearer tokens. Use `OU_UI_SMOKE_INSECURE_TLS=1` for self-signed HTTPS, `OU_UI_SMOKE_USERNAME` / `OU_UI_SMOKE_PASSWORD` for explicit credentials, or `OU_UI_SMOKE_CREDENTIALS_FILE=/path/to/credentials.env` for a different credentials file. `--report` or `OU_UI_SMOKE_REPORT_PATH` writes only checks, HTTP status codes, timestamps, and non-sensitive summaries with `0600` permissions. By default it also sends one stateless POST without `X-CSRF-Token` and expects `403 csrf.required`; that does not create a task or change business configuration, but it does leave sanitized `audit.denied` evidence. Run `sudo ou sm --skip-csrf-probe`, set `OU_UI_SMOKE_CSRF_PROBE=0`, or pass `-- --skip-csrf-probe` for a read-only smoke run.

What the installer currently does:

- displays an interactive install agreement
- asks for the Master panel port
- asks whether a domain already points to the host
- when a domain is available:
  - installs and configures `acme.sh`
  - requests a Let's Encrypt certificate
  - installs the certificate under the OU-UI Next config directory
  - writes nginx HTTPS configuration and reload behavior
- when no domain is available:
  - deploys through IP + port over HTTP
- always:
  - generates a 16-character secure path
  - generates a random admin username
  - generates a random admin password
  - generates a session secret for HttpOnly operator login cookies
  - generates an operator token for the backend proxy path
  - syncs the latest Master source from GitHub
  - deploys nginx, a systemd service, and persistent control-plane state directories
  - prints the final access URL and credentials at the end

### Zero-Config Intent

The installer is intentionally optimized for "ask less, automate more":

- panel access is protected by a generated secure path, the in-app login screen, and a server-side HttpOnly operator session; the browser Basic Auth dialog should not appear
- the installer checks the deployed panel URL before finishing, verifies that it is serving the OU-UI Next frontend login page, and fails fast if a Basic Auth response is detected
- `8443` / `9443` are the recommended dedicated panel ports; `443` remains selectable, but the installer asks for explicit confirmation because it is the most likely port to collide with existing sites, reverse proxies, or old panels
- if a browser system-auth dialog appears, run `ou d` first to diagnose stale nginx sites, same-port conflicts, or Basic Auth leftovers; prefer avoiding `443` on reinstall unless you know it is free
- if the fresh install is not on the latest frontend, stale demo nodes still appear, shortcuts are missing, or the panel URL still returns Basic Auth, run `ou fix --force`; it updates from GitHub, rewrites the nginx panel site, clears old control-plane state, and verifies that the managed-host inventory is empty again
- API calls are proxied through nginx; browser-side `/api`, `/events`, and `/metrics` requests pass an `auth_request` check against the HttpOnly session before nginx injects the backend operator token. Session-backed `/api/v1` mutations also validate `X-CSRF-Token`. Neither the operator token nor the login password is written into the frontend bundle
- browser sign-out calls `DELETE /api/v1/auth/session`; the Security Policy workspace fetches operator sessions separately and can revoke individual sessions so old cookies stop working immediately
- The installer and `ou fix --force` Agent install-command self-check read the CSRF token from the session login response and send `X-CSRF-Token` on cookie-backed mutations, so repair and reset flows are not blocked by CSRF protection
- Agent one-click install commands download `public/install/ou-agent.sh` from GitHub raw by default, avoiding dependency on local Master static files or panel login protection
- fresh production installs do not inject demo nodes; managed hosts appear only after an Agent registers, initially as provisioning until real heartbeat or telemetry arrives
- Agent install commands only enroll the host and initialize runtime components; host name, monthly quota, expiry, and probe target are edited later in the panel
- SSL issuance and nginx wiring are automated when a valid domain is available
- IP + port deployment remains available for hosts without a domain

This is deployment automation for the current Master control-plane surface. Full multi-node production hardening, durable external database choices, operator identity policy, and Agent registration/rotation policy still need continued implementation and validation.

## Development

Install dependencies:

```bash
npm install
```

Run the frontend:

```bash
npm run dev
```

Run the service-backed control plane locally:

```bash
npm run start:control-plane
```

## Verification

Run the project checks:

```bash
npm run test
npm run lint
npm run typecheck
npm run build
```

After a live deployment, run the production-entry smoke test:

```bash
sudo ou sm
```

Generate an archivable production acceptance evidence bundle:

```bash
sudo ou qa
```

## Repository Landmarks

- `src/app` - app shell, runtime config, navigation
- `src/components` - reusable UI primitives and layout scaffolding
- `src/features` - feature workspaces
- `src/server/control-plane` - service-backed Master control plane runtime
- `src/services/api` - typed API contracts, HTTP adapter, mock adapter bridge
- `docs/architecture` - backend and control-plane boundary notes
- `docs/openapi` - machine-readable API contract
- `scripts/install-master.sh` - one-click Master deployment entrypoint

## Delivery Direction

OU-UI Next is moving toward a production-grade V1 through incremental, verifiable work:

- modernized frontend implementation from the original UI blueprint
- typed domain and API contracts
- service-backed backend kernel
- task, audit, permission, and runtime state boundaries
- deployment automation focused on beginner-friendly Master installation

The repository has a practical foundation, but it should still be treated as an evolving V1 implementation rather than a fully hardened multi-node operations platform.
