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
- **Typed control-plane contracts**
  - OpenAPI spec: [docs/openapi/ou-ui-next-v1.yaml](docs/openapi/ou-ui-next-v1.yaml)
  - Zod request validation and API envelope handling
- **Service-backed HTTP control plane**
  - local backend entrypoint: `src/server/control-plane/http-control-plane-main.ts`
  - service/repository boundaries for tasks, audit, idempotency, outbox, runtime release models, and permission persistence
  - protected `/events/v1/tasks` streams cursor-resumable task-status history and audit snapshots first; task-status events replay the full durable `queued/running/succeeded/failed/...` chain from persisted audit evidence, then tail new task/audit events by polling the durable read model; the default sqlite-backed production deployment can continue follow-up task events across panel instances
  - protected `/events/v1/system-alerts` streams the current active system-alert snapshot and emits a new snapshot when the alert fingerprint changes; active alerts cover Agent offline state, sampling gaps, red high latency, required runtime service failures, command outbox overdue/dead-letter state, runtime apply health failures that triggered automatic rollback, runtime reload failures, external archive sink failures, subscription-source sync warning/failed state, and quota exceeded state; command outbox dead-letter alerts now include metadata counts for ACK timeout, result timeout, unknown, and other reasons, subscription-source alerts expose only source ID, name, status, node count, and a non-sensitive warning summary, external archive alerts include failed batch and failed record counts plus the latest failed archive kind, and the dashboard active-alert card surfaces those details directly so operators and SSE/webhook consumers can triage failures without querying raw rows; `ou-ui doctor` reports command timeout sweep enablement, ACK/result timeout, sweep interval, and max-command config health before backend startup; alerts then reconcile with a durable lifecycle read model and persist `active` / `resolved` evidence in the control-plane store; when `OU_UI_SYSTEM_ALERT_WEBHOOK_URL` or `OU_UI_SYSTEM_ALERT_WEBHOOK_URLS` is configured, alert activation, meaningful updates, and resolution enqueue sanitized JSON webhook notifications per channel in a durable retry/dead-letter queue; the default delivery path blocks localhost/private/link-local/multicast targets and targets that resolve to those addresses, optionally enforces `OU_UI_SYSTEM_ALERT_WEBHOOK_EGRESS_ALLOWLIST`, pins delivery to the verified public address, and records sanitized structured delivery logs with channel IDs and labels; `ou-ui doctor` reports configured alert webhook targets, host diagnostics, allowlist, retry timings, invalid positive-integer settings, and bearer-token presence without printing the token
  - service-backed read APIs rebuild the current durable read model from persisted tasks, Agent events, and subscription state before returning, so managed-host, subscription, and port-forwarding snapshots converge across sibling sqlite-backed panel instances without relying on one process memory image or a restart replay
  - protected `/api/v1/observability-metrics` returns an operator diagnostics snapshot for task states, completion latency, rollback counts, command outbox backlog/leases/overdue/dead-letter counts, ACK/result latency, Agent offline/degraded counts, system-alert severity and kind counts including Agent offline, command outbox overdue/dead-letter, runtime apply health failed, runtime reload failed, external archive sink failed, subscription-source sync warning/failed, and quota exceeded alerts, system-alert webhook retry/dead-letter counts plus per-channel delivery health, quota policy totals/exceeded/disabled/scope/enforcement-state/used and limit bytes, retained Agent log chunk totals/bytes/time ranges, Agent log archive bucket/chunk/byte/time-range totals, retained traffic rollup totals, per-dimension counts, earliest/latest sample timestamps, cumulative metered bytes, audit-chain verification state, denied audit counts, quota-exceeded audit counts, and external archive sink failure counts plus failed record counts
  - protected `/metrics` exposes the current diagnostics snapshot as Prometheus text gauges for external scraping, includes quota policy scope/state/used/limit time series, external archive sink failure and failed-record counters, system-alert notification `channel_id` / `channel_label` / `status` series, and renders task completion, per-operation completion, runtime apply, command ACK, and command result latency as `_bucket` / `_sum` / `_count` histograms
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
  - operator bearer authentication failures on protected REST, SSE, and Prometheus routes return `401 unauthorized` promptly and append sanitized `audit.denied` evidence without bearer tokens; repeated failures from the same source are throttled by a default 60-second / 20-failure window, return `429 operator_auth.rate_limited` after the limit, and append only one throttle audit entry per window; `ou-ui doctor` reports operator auth throttle window, failure-limit config health, backend bearer-token presence, stale frontend operator-token exposure, and deployed static-bundle scans for known operator secrets before backend startup without printing tokens; sqlite-backed denied-audit writes read the previous audit hash through the same transaction so auth failures cannot self-block on the repository queue
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

Status checks are split intentionally: `ou s` shows the systemd service state, while `ou d` runs the full installation doctor for nginx, Basic Auth, panel URL, service state, the current control-plane storage path, source commit, and deployed frontend build commit.
Before uninstalling, back up anything you need to keep. `ou x` / `ou-ui uninstall` removes the install directory, config directory, state directory, web root, nginx site, and systemd service. If install or update created the low-memory build swap, uninstall first disables that swap, removes the matching `fstab` entry, and then deletes the state directory so the host is not left with system-level residue.
`OU_UI_LOCAL_SOURCE_DIR` is intended for development/debug deployments only. Production updates should use the GitHub install path so `ou u` / `ou f` can pull the latest remote release directly.
Managed hosts also get an `ou-agent` shortcut after enrollment: `ou-agent` opens its menu, `ou-agent status` checks local Agent state, `ou-agent update` updates the Agent runtime from GitHub without re-registering or consuming a new install token, and `ou-agent uninstall` removes the host Agent.

Short aliases are installed automatically: `ou p` prints panel information, `ou c` prints login credentials, `ou rc` rotates operator login credentials, `ou rs` restarts the service, `ou u` updates from GitHub, `ou b` backs up control-plane state, `ou f` runs the one-click repair flow, `ou r` resets control-plane state, `ou m` changes port/certificate settings, `ou d` runs diagnostics, and `ou x` uninstalls the panel.

`ou-ui credentials` / `ou c` prints the full panel URL, username, and password. Appending `--help` / `-h` prints usage only, never reads or outputs login credentials, and other extra arguments are rejected to avoid accidental disclosure. Install, update, and repair self-checks now JSON-encode the login payload and pipe it to `curl` through stdin instead of interpolating the password into command-line arguments. `ou-ui rotate-credentials` / `ou rc` generates a new random operator username/password, updates the backend `scrypt:v1` hash, removes backend plaintext password compatibility, and invalidates existing browser sessions; use it immediately when `ou d` reports default or weak credentials on an upgraded install. `ou-ui doctor` / `ou d` checks nginx, Basic Auth, service state, the current control-plane storage path, operator credential strength, source commit, and deployed frontend build commit. `ou-ui backup-state` / `ou b` creates a backup of the current control-plane store, defaulting to the control-plane backup directory unless you pass an explicit output path, and writes a `.manifest.json` sidecar with the backup SHA-256, size, storage mode, creation time, and source commit. `ou-ui restore-state <backup-path>` validates the manifest SHA-256 and size when present, validates a SQLite backup, creates a pre-restore snapshot, stops the service, and switches the live store to that backup; append `yes` to skip the interactive confirmation. `ou-ui fix` / `ou f` pulls the latest GitHub source, rebuilds the frontend, refreshes shortcuts, restarts services, rewrites the OU-UI nginx panel site, and verifies the login page, Basic Auth surface, and frontend build fingerprint. When upgrading older installs whose static files were refreshed by the current build but still lack `build-info.json`, the same update writes the missing fingerprint before the strict self-check continues. If a fresh install still shows stale demo data, run `ou fix --force` to clear the old control-plane state automatically. `ou-ui repair-nginx` rewrites the panel nginx config without rebuilding the frontend. `ou-ui reconfigure` / `ou m` reopens the installer to change the port, certificate, or nginx wiring while preserving the existing secure path, login credentials, operator token, session secret, and Agent bootstrap token. The installer also creates `ou-ui-next`, `ou-ui`, and `ouui` as equivalent shortcuts.

By default the installer pulls the `cshaizhihao/ou-ui-next` `main` branch from GitHub and builds it on the server. Users do not need to clone the repository first. Local source deployment is now an explicit development/debug path via `OU_UI_LOCAL_SOURCE_DIR=/path/to/ou-ui-next`.
Production installs now persist control-plane state in a SQLite database file by default; when an older deployment still has the legacy JSON state file, the installer preserves that source path and the backend imports it on the first SQLite boot. SQLite storage and maintenance commands validate `schema_version`, `state_format`, and the `control_plane_migrations` ledger before serving or validating state; older v1 SQLite stores are backfilled with the current migration ledger when opened by the backend or backed up by the SQLite tool, and restored legacy v1 backups get the ledger on the restored target database. The post-install management CLI also provides a local single-node backup/restore path with SHA-256 manifests. The underlying SQLite maintenance tool `scripts/control-plane-sqlite-tool.cjs backup` writes a `.manifest.json` sidecar directly, `validate` / `restore` verify the manifest schema, file size, and SHA-256 when that sidecar is present, and the manifest records the SQLite migration ledger, so operators can snapshot and verify the control plane before updates, repairs, or rollback work. The installer also configures `OU_UI_EXTERNAL_ARCHIVE_DIRECTORY` by default so retention-pruned Agent log summaries, traffic compaction buckets, and audit-chain anchors are appended to JSONL archive files outside the control-plane state store.

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
