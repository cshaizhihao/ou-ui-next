# OU-UI Next HTTP Control Plane Adapter V1

Last updated: 2026-06-05

This document records the current V1 HTTP adapter boundary. It is intentionally explicit about what is implemented and what is still a production backend responsibility.

## Implemented Boundary

The frontend now depends on `ControlPlaneApi` instead of importing the mock adapter directly. The API implementation is selected by `src/services/api/create-control-plane-api.ts`.

Default mode:

```text
VITE_CONTROL_PLANE_MODE unset or mock -> createMockApi()
```

HTTP mode:

```text
VITE_CONTROL_PLANE_MODE=http
VITE_CONTROL_PLANE_BASE_URL=http://127.0.0.1:<port>
VITE_CONTROL_PLANE_AGENT_ID=agent-hkg-01
VITE_CONTROL_PLANE_OPERATOR_TOKEN=<operator bearer token when backend auth is enabled>
VITE_CONTROL_PLANE_AGENT_TOKEN=<agent bearer token when backend auth is enabled>
```

The HTTP client is implemented in `src/services/api/http-control-plane-client.ts`. It unwraps response envelopes, maps non-2xx error envelopes into `HttpControlPlaneClientError`, and preserves the `ControlPlaneApi` method surface.

## Running the Service-Backed Control Plane

The service-backed backend can be started locally without the frontend dev server:

```powershell
$env:OU_UI_CONTROL_PLANE_HOST='127.0.0.1'
$env:OU_UI_CONTROL_PLANE_PORT='4010'
npm.cmd run dev:control-plane
```

By default it uses in-memory storage. To keep mutation state across local backend restarts, enable SQLite storage:

```powershell
$env:OU_UI_CONTROL_PLANE_STORAGE='sqlite'
$env:OU_UI_CONTROL_PLANE_SQLITE_FILE='D:\ou-ui-control-plane\control-plane.sqlite'
npm.cmd run dev:control-plane
```

Storage modes:

- `OU_UI_CONTROL_PLANE_STORAGE=memory` or unset: keeps task, audit, idempotency, outbox, Agent event, and permission mutation state only for the process lifetime.
- `OU_UI_CONTROL_PLANE_STORAGE=file`: persists the current control-plane repository state into `OU_UI_CONTROL_PLANE_STATE_FILE` by writing a temporary JSON file and renaming it into place after a successful transaction.
- `OU_UI_CONTROL_PLANE_STORAGE=sqlite`: persists the current control-plane repository state into `OU_UI_CONTROL_PLANE_SQLITE_FILE` inside a SQLite database file, enables WAL-backed transactional commits, validates `schema_version` / `state_format` metadata before serving reads or writes, and can import a legacy JSON state file from `OU_UI_CONTROL_PLANE_LEGACY_STATE_FILE` when the database is first created.
- `OU_UI_SUBSCRIPTION_SOURCE_EGRESS_ALLOWLIST`: optional comma-separated external subscription source host allowlist. Entries may be exact hosts, URL values whose host will be used, or suffix wildcards such as `*.trusted.example.com`. When set, external subscription sync fails before DNS and fetch if the source host does not match.
- `OU_UI_SUBSCRIPTION_SOURCE_SYNC_BUDGET_MAX_FETCHES_PER_DAY` and `OU_UI_SUBSCRIPTION_SOURCE_SYNC_BUDGET_MAX_BYTES_PER_DAY`: optional default provider-account daily budgets for external subscription source sync. Per-source import metadata can override the default budget and set a non-sensitive `providerAccountId`; otherwise the provider host is used as the budget key.
- `OU_UI_EXTERNAL_ARCHIVE_DIRECTORY`: optional file sink directory for archive evidence outside the control-plane state payload. When set, new Agent log archive summaries append to `agent-log-archives.jsonl`, new traffic rollup compaction buckets append to `traffic-rollup-compactions.jsonl`, and committed audit hash anchors append to `audit-anchors.jsonl` after the control-plane transaction commits. Installer-managed production defaults this to the state directory's `external-archives` child.

Production installs that use SQLite storage also expose `ou-ui backup-state` and `ou-ui restore-state <backup-path>` so operators can create local snapshots and restore them through the management CLI without hand-copying the database file. Backup commands now write a `.manifest.json` sidecar containing SHA-256, file size, storage mode, creation time, and source commit; restore commands verify the manifest hash and size when present before staging the restored database. SQLite backup, restore, validation, and `ou-ui doctor` diagnostics reject unsupported `schema_version` or `state_format` metadata instead of accepting a database created by a newer OU-UI build. Installer-managed production also configures the file archive sink by default so retention-pruned Agent log summaries, traffic compaction buckets, and audit-chain anchors are retained outside the SQLite state payload.

Optional bootstrap bearer-token auth can be enabled for local production-hardening runs:

```powershell
$env:OU_UI_CONTROL_PLANE_OPERATOR_TOKEN='replace-with-operator-token'
$env:OU_UI_CONTROL_PLANE_OPERATOR_ACTOR='local-operator'
$env:OU_UI_CONTROL_PLANE_OPERATOR_GROUP_ID='owner'
$env:OU_UI_CONTROL_PLANE_RESOURCE_GROUP_ID='group-premium'
$env:OU_UI_CONTROL_PLANE_AGENT_TOKENS_JSON='{"agent-hkg-01":"replace-with-agent-token"}'
$env:OU_UI_CONTROL_PLANE_OPERATOR_AUTH_FAILURE_WINDOW_MS='60000'
$env:OU_UI_CONTROL_PLANE_OPERATOR_AUTH_FAILURE_LIMIT='20'
npm.cmd run dev:control-plane
```

When operator auth is configured, protected control-plane reads and all operator mutations require either `Authorization: Bearer <operator-token>` or a valid HttpOnly operator session cookie from `POST /api/v1/auth/session`. The adapter derives `actor`, `operatorGroupId`, and `resourceGroupId` from the authenticated token/session identity instead of trusting spoofable `X-Actor` and group headers. `GET /api/v1/boundary` remains open for version discovery.

Production installer nginx templates expose the frontend login page without browser Basic Auth, keep the backend operator token server-side, and use `auth_request` to verify the HttpOnly session before proxying browser `/api`, `/events`, or `/metrics` requests with the backend bearer token. The Vite frontend no longer reads or embeds the generated login password. Installer-managed backends prefer `OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD_HASH` in `scrypt:v1:<saltHex>:<keyHex>` format for session login verification; the generated plaintext password is retained only in a root-only credentials file for `ou-ui credentials` and CLI self-check login, while older `OU_UI_CONTROL_PLANE_OPERATOR_PASSWORD` deployments remain accepted for compatibility and are migrated by the management CLI defaults. `ou-ui doctor` reports whether the backend environment still contains plaintext password material, whether the root-only credentials file has restrictive permissions, and whether the current operator credential still looks like a default/weak legacy value. `ou-ui rotate-credentials` generates a fresh random operator identity, rewrites the root-only credentials file, updates the backend password hash, removes backend plaintext password compatibility, and rotates the operator session secret so existing browser sessions are invalidated.

Repeated failed operator authentication attempts are throttled per source by a default 60-second / 20-failure window. Attempts inside the window still return `401 unauthorized` and append sanitized `audit.denied` evidence; the first over-limit attempt returns `429 operator_auth.rate_limited` and appends one throttle audit entry, and later attempts in the same window return `429` without adding more audit rows.

When Agent auth is configured, `/agent/v1/poll`, `/agent/v1/events`, and `/agent/v1/credentials/rotate` require `Authorization: Bearer <agent-token>` and the token-bound `agentId` must match the request body and every submitted event.

Service-backed Agent enrollment uses `POST /agent/v1/register` to exchange the short-lived install token for a persisted runtime Agent credential. The install credential is revoked after redemption, registration version/platform/capability metadata is retained for the managed-host read model, the runtime credential issuance is appended to the audit chain without raw token material, and service-backed poll/event routes accept `purpose: runtime` credentials only.

Operators can inspect sanitized credential records with `GET /api/v1/agent-credentials`, revoke a credential with `POST /api/v1/agent-credentials/{credentialId}/revoke`, and rotate active runtime credentials with `POST /api/v1/agent-credentials/{credentialId}/rotate`. The Security Policy workspace renders only `tokenPrefix`, purpose, status, session, and audit metadata; it never renders raw token material or `tokenHash`.

Runtime Agent credentials are bound to the `sessionId` submitted at registration. Service-backed `/agent/v1/poll`, `/agent/v1/events`, and `/agent/v1/credentials/rotate` reject the credential when the request or event session does not match that bound session. The installed Agent attempts `/agent/v1/credentials/rotate` before runtime credential expiry, writes the returned token atomically to its local environment, and reloads that environment on the next runner loop. Explicit operator revocation still immediately invalidates the old runtime credential and does not reuse the redeemed one-time install token.

Useful smoke endpoints:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:4010/api/v1/boundary'
Invoke-RestMethod -Uri 'http://127.0.0.1:4010/api/v1/snapshot'
```

The CLI entrypoint is `src/server/control-plane/http-control-plane-main.ts`. It uses `tsx` for local TypeScript execution and the service-backed factory in `src/server/control-plane/create-service-backed-control-plane.ts`.

## HTTP Routes

Implemented server adapter: `src/services/api/http-control-plane-server.ts`.

Read model:

- `GET /api/v1/boundary`
- `GET /api/v1/snapshot`
- `GET /api/v1/agents`
- `GET /api/v1/nodes`
- `GET /api/v1/inbounds`
- `GET /api/v1/subscription-sources`
- `GET /api/v1/subscription-bundles`
- `GET /api/v1/forward-rules`
- `GET /api/v1/quota-policies`
- `GET /api/v1/rate-limit-policies`
- `GET /api/v1/permission-grants`
- `GET /api/v1/routing-policies`
- `GET /api/v1/tuning-profiles`
- `GET /api/v1/command-outbox`
- `GET /api/v1/config-revisions`
- `GET /api/v1/preflight-plans`
- `GET /api/v1/runtime-snapshots`
- `GET /api/v1/tasks`
- `GET /api/v1/tasks/{taskId}`
- `GET /api/v1/audit-logs`
- `GET /api/v1/audit-logs:verify`

Mutation / Agent runtime:

- `POST /api/v1/tasks`
- `POST /api/v1/tasks/{taskId}/transition`
- `POST /api/v1/agents/{agentId}/commands`
- `POST /api/v1/quota-policies/{quotaPolicyId}/reset`
- `GET /api/v1/agent-credentials`
- `POST /api/v1/agent-credentials/{credentialId}/revoke`
- `POST /agent/v1/register`
- `POST /agent/v1/credentials/rotate`
- `POST /agent/v1/poll`
- `POST /agent/v1/events`

All mutation routes require `X-Request-Id`. In open development mode they also require `X-Actor` and accept `X-Operator-Group-Id` and `X-Resource-Group-Id`. In bearer-token mode the adapter derives actor and group identity from the configured token registry and ignores spoofed actor/group headers for authorization context. Mutations also accept `Idempotency-Key`, `If-Match`, `X-Forwarded-For`, and `User-Agent`.

## Validated Runtime Contracts

The adapter validates these payloads with Zod schemas from `src/services/api/api-contract.ts`:

- `CreateTaskRequest`
- `TransitionTaskRequest`
- `AgentCredentialRevokeRequest`
- `AgentCommandEnvelope`
- `AgentRegistrationRequest`
- `AgentPollRequest`
- `AgentEventsRequest`
- `AgentEventEnvelope`

The OpenAPI contract lives in `docs/openapi/ou-ui-next-v1.yaml` and is covered by `src/services/api/openapi-contract.test.ts`.

## Current Guarantees

- Task creation is idempotent in the mock-backed adapter.
- Service-backed Agent registration exchanges one-time install credentials for runtime credentials, stores only token digests, revokes the install credential after successful redemption, appends a sanitized runtime credential issuance audit event, audits denied registration attempts for missing/invalid/expired install tokens and identity mismatches without token material, and projects the registered host as `provisioning` until real heartbeat or telemetry arrives.
- Agent credential list/revoke/rotate APIs expose sanitized credential summaries to operators; revocation writes `agent.credential.revoked` into the audit hash chain, rotation writes `agent.credential.rotated`, and revoked credentials become unusable for subsequent Agent authentication. Runtime Agents can also rotate their own active credential through `/agent/v1/credentials/rotate` before expiry without exposing raw token material to the browser.
- Runtime Agent credentials are bound to the registration session and reject mismatched or missing session identities on service-backed poll/event/self-rotation requests.
- Agent poll/event authentication failures and identity mismatches append sanitized `audit.denied` evidence without bearer token material.
- Operator bearer authentication failures on protected REST, SSE, and Prometheus routes return `401 unauthorized` promptly and append sanitized `audit.denied` evidence without bearer token material, with per-source throttling to prevent unbounded audit-chain growth. Denied-audit appends read the previous audit hash through the active repository transaction, so sqlite-backed production deployments do not self-block on the serialized repository queue while handling auth failures. If a denied-audit append fails, the HTTP server keeps the original auth response, emits an `audit.write_failed` structured log event, increments the runtime audit write-failure metric, and projects a critical `audit.write_failed` system alert through the shared active/resolved lifecycle.
- Agent poll accepts `sessionId` and `lastSeenCommandSeq`, leases commands with the polling session bound into the `AgentCommandEnvelope`, records `leaseOwnerId` / `leaseSessionId` on the command outbox read model, and records an Agent session liveness read model in the service-backed repository.
- Agent event intake persists events, deduplicates by `eventId`, records heartbeat/session liveness, and rejects stale events inside the same `agentId + sessionId` monotonic sequence window.
- Service-backed Agent read models derive `online`, `degraded`, and `offline` status from the most recent heartbeat or telemetry signal using the configured 30-second probe cadence. Host telemetry snapshots separately derive sampling-gap state from `telemetry.reportedAt` and red high-latency state from the configured latency thresholds; fresh heartbeat events do not clear stale telemetry samples, and active Agent offline state, gaps, or high-latency samples project into the system alert read model.
- The published Agent runtime script sends heartbeat after each poll, samples ping/hardware/disk/network/traffic telemetry on the configured 30-second cadence, queues automatic heartbeat/telemetry/log/ACK/result events for retry when Master delivery fails, bounds the local pending queue to 1000 events by default while pruning routine heartbeat/telemetry before command ACK/result evidence, rotates local `agent.log` at 5 MiB with 3 backups by default, emits bounded `log_chunk` events for command runtime output and result summaries after ACK and before result, executes explicit `health` and `telemetry` commands, and reports unsupported command types as failed results.
- Idempotency conflicts write `audit.denied`.
- Stale `If-Match` on supported resources writes `audit.denied`.
- Permission overreach for `permission.grant` writes `audit.denied`.
- High-risk task mutations require matching `riskConfirmation.operation` and `riskConfirmation.targetId`; missing or mismatched confirmation writes `audit.denied` with `high_risk_confirmation.required`.
- `permission.revoke` rejects changes that would remove the final active `grant` permission path for a resource and writes `audit.denied`.
- Repository audit appends reject duplicate `auditLog.id` values, and file-backed state loading rejects duplicate audit IDs before serving the ledger.
- `GET /api/v1/audit-logs:verify` verifies the persisted audit chain; `POST /api/v1/audit-logs:verify` accepts an exported `auditLogs` array and verifies it without mutating server state. When the external archive directory is configured, each committed audit log also appends a sanitized `hash` / `prevHash` anchor to `audit-anchors.jsonl` after the repository transaction commits.
- Agent ACK moves a queued task to running.
- Agent result moves a running task to succeeded or failed.
- Agent command-backed runtime tasks cannot be manually transitioned to `succeeded`; success must come from Agent result events.
- Command outbox entries can be created by task mutations or explicit `issueAgentCommand`.
- Agent polling leases eligible commands, marks them `dispatched`, increments `attempts`, records `leaseOwnerId`/`leaseSessionId` plus `leasedAt`/`leaseExpiresAt`, suppresses duplicate in-flight polls, and retries after lease expiry until the command deadline expires. When Agent auth is enabled, the lease owner is the authenticated credential ID rather than raw token material.
- Deadline-expired commands are marked `expired`, linked queued/running/retrying tasks are failed with `command.deadline.expired`, and a task failure audit is appended.
- Agent ACK/result events observed at or after command deadline are rejected with `agent_event.command_deadline_expired`; the stale event does not advance the task to succeeded.
- Agent ACK/result/log events whose `commandId`, `taskId`, or `agentId` do not match the command outbox record are rejected with `agent_event.command_task_mismatch`; the event is not recorded and cannot update outbox state or another task projection.
- The service-backed Control Plane starts a configurable command timeout sweep job by default. It runs the same deadline, ACK timeout, and result timeout logic as the protected manual sweep API. Production service instances use the real process clock for task timestamps, outbox deadlines, and sweep observations; tests inject a deterministic clock explicitly.
- Runtime command compilation now differentiates `apply`, `reload`, and `rollback` Agent command envelopes. Apply commands reference persistent config revision, preflight plan, and runtime snapshot records that are queryable through the HTTP API.
- Runtime apply checksums are generated from the canonical inline artifact JSON. The published Agent verifies checksum and `sig-v1` digest before creating the local snapshot, running module preflight, or writing runtime files.
- Agent result events now advance runtime release read models in the same repository transaction as task/outbox/audit updates: successful apply marks config revisions `applied`, preflight plans `passed`, and snapshots `verified`; failed apply marks config/preflight records `failed`, retains failed health summaries, and maps the failure reason to the matching preflight check; successful apply/reload/rollback results with missing or mismatched `appliedConfigRevision` are normalized to failed result-verification records; successful rollback marks the referenced snapshot `restored`.
- Runtime apply failures caused by post-apply health checks now create a system actor `agent.rollback` task in the same result transaction, using the failed command's `snapshotBeforeId` and Agent identity; the failed source task stores `rollbackTaskId`, while checksum/schema/preflight-style failures remain failed without automatic health rollback.
- Port forwarding read models now require Agent-result verification before allocation: create/update/apply tasks project as `deploying` until every target Agent command completes successfully with the expected config revision, delete tasks remain `releasing` until verified, and telemetry samples only update traffic/quota counters.
- Port forwarding apply artifacts carry `rateLimitMode` and `rateLimitDirection`; the published Agent maps those fields to GOST `limiter.in` / `limiter.out` so one-way ingress, one-way egress, and bi-directional rule limits are applied by the runtime.
- Local Xray subscription rendering now keeps VLESS client parameters aligned with the deployed runtime client: URI output uses the matched client's `flow` before any inbound-level fallback, and multi-client inbounds are expanded per subscription identity before URI, Clash/Mihomo, or Sing-box output is generated.
- Managed-host and port-forwarding telemetry now carries `trafficBillingPeriod`; the service-backed and mock adapters project current monthly usage from `monthlyResetDay`, ignore previous-period traffic samples, and reset stale read-model usage at snapshot time without deleting retained Agent events.
- Managed-host traffic calibration is included in the Master-side compatibility derivation path: if Agent telemetry omits explicit `monthlyTrafficUsedBytes`, the read model adds `manualUsedTrafficBytes` to the metered ingress/egress total according to the configured accounting mode; quota-policy aggregation never reports less than the manual calibration, and quota reset replay writes the derived monthly total back into the adjusted telemetry payload.
- Agent telemetry samples now append host, forwarding, and Xray client counter records into `TrafficRollup` history. The service-backed repository persists the rollup read model and exposes it through filterable `/api/v1/traffic-rollups`, `/api/v1/traffic-rollups:export`, `GET/PATCH /api/v1/traffic-rollup-retention-policy`, and snapshots; the retention read model includes the runtime default, control-plane override, and effective policy; rollup writes prune retained history by age and per-scope cap in the same repository transaction, compact removed raw samples into UTC-day `TrafficRollupCompaction` buckets grouped by dimension / Agent / subject / period, and expose those buckets through `/api/v1/traffic-rollup-compactions` plus `/api/v1/traffic-rollup-compactions:export`; the dashboard aggregates retained samples by managed host, forwarding rule, and customer node, can export the selected dimension as JSONL diagnostics, shows selected-dimension compaction archive bucket/sample/metered/latest totals, exports the selected archive as JSONL diagnostics, and lets operators edit the traffic history retention override in place; `/api/v1/observability-metrics` and `/metrics` expose retained rollup totals, per-dimension counts, earliest/latest sample timestamps, cumulative metered bytes, compaction bucket totals, represented raw sample totals, earliest/latest archive bucket timestamps, and archive metered bytes; and `/api/v1/agents`, `/api/v1/system-alerts`, snapshots, and `/events/v1/system-alerts` expose derived sampling-gap fields and active alert state for each affected host.
- `/api/v1/quota-policies` now aggregates live quota read models from managed hosts, Xray customer nodes, subscription users, forwarding accounts, forwarding links, and forwarding rules instead of returning only static seed rows. The security workspace uses those derived policies to surface current-window usage, billing direction, reset cadence, and guardrail disable reasons by scope.
- `/api/v1/customers` now exposes a decoupled customer directory derived from customer nodes, subscription identities, and port-forwarding owner names. Service-backed and mock adapters dedupe same-name customers across sources, keep Chinese/non-Latin customer names distinct, and aggregate traffic as `max(customer-node usage, subscription usage) + forwarding usage` so local Xray subscription traffic is not double-counted. The frontend `客户管理` route consumes this read model directly and shows customer source coverage, resource counts, quota state, traffic, expiry, and latest activity outside the managed-host workspace.
- `POST /api/v1/quota-policies/{quotaPolicyId}/reset` now creates real `quota.reset` tasks: it records before/after audit snapshots, zeros the matching quota read model immediately, and re-baselines later Agent telemetry and subscription-user public output so pre-reset counters are not re-counted.
- Forward-rule, forwarding-account, and forwarding-link quota enforcement now create system actor `forward.pause` and `forward.resume` tasks from live quota transitions. Service-backed and mock adapters both reuse the existing Agent apply/outbox path so automatic disable/recovery leaves durable task and audit evidence instead of only flipping read-model flags.
- `/api/v1/observability-metrics` returns a protected operator diagnostics snapshot derived from current tasks, command outbox, Agent liveness, active system alerts, system-alert webhook notification queue state, retained Agent log chunks, Agent log archive summaries, retained traffic rollups, and audit-chain state. It covers task status totals, completion latency, completion latency grouped by task operation, runtime apply latency grouped by module, rollback counts, command backlog/lease/overdue/dead-letter counts, ACK/result latency, Agent offline/degraded counts, alert severity and kind counts including `audit.write_failed` and system-alert notification delivery health, webhook retry/dead-letter counts, Agent log retained chunk totals/bytes/time ranges, Agent log archive bucket/chunk/byte/time-range totals, traffic rollup retained totals, per-dimension counts, earliest/latest sample timestamps, cumulative metered bytes, audit validity, denied audit counts, quota-exceeded audit counts, and HTTP-observed audit write-failure counts.
- `/metrics` is protected by the same operator bearer-token boundary and renders the current observability snapshot as Prometheus text gauges for external metrics scraping.
- The system-alert lifecycle derives Agent offline alerts from the service-backed liveness read model, so stopped Agents are visible through `/api/v1/system-alerts`, snapshots, `/events/v1/system-alerts`, metrics kind counts, and configured webhook fan-out.
- The system-alert lifecycle now derives command outbox overdue and dead-letter alerts from the durable outbox read model, so stalled Agent delivery is visible through `/api/v1/system-alerts`, snapshots, `/events/v1/system-alerts`, metrics kind counts, and configured webhook fan-out.
- The system-alert lifecycle derives runtime reload failed alerts from the durable task read model, grouped by runtime target and resolved only after a newer successful reload for that same target.
- Live quota policies in `exceeded` or `disabled_by_quota` state now derive quota-exceeded system alerts with scope, usage, limit, guardrail, and runtime-disabled metadata, sharing the same REST/snapshot/SSE/metrics/webhook lifecycle.
- HTTP-observed denied-audit write failures now derive `audit.write_failed` system alerts from the in-process runtime signal, sharing the same REST/snapshot/SSE/metrics/webhook lifecycle and resolving when the runtime signal is absent.
- System-alert webhook notification deliveries that are overdue for retry or dead-lettered now derive system-alert notification health alerts, making a broken external alert route visible through REST/snapshot/SSE/metrics/dashboard even when that same route cannot deliver.
- The production HTTP entrypoint injects a JSON structured logger. It emits request completion/error events plus task, command, Agent poll, Agent events, credential, and subscription-sync operational events with `requestId`, W3C `traceparent` context, `taskId`, `commandId`, `agentId`, and non-sensitive lifecycle fields.
- Xray telemetry now accepts `xrayClientCounters`; the Agent stores Xray client profiles beside applied inbounds, enables StatsService in the managed Xray config, baselines per-client monthly uplink/downlink counters, and projects current client usage into `XrayInbound.clients[].usedTrafficBytes`. When StatsService is unavailable, the Agent emits `source: xray-guardrail` samples so quota/expiry state still reaches the Master without clobbering the last valid traffic counters.
- Agent host telemetry now accepts Linux load averages, latency bands, sanitized runtime service health rows for the Agent, Xray, and port-forwarding systemd units, plus host-level guardrail stopped/restored unit evidence. The Agent stops managed Xray/port-forwarding units on host quota or expiry guardrail hits, restores only units previously stopped by that guardrail after policy recovery, and reports `hostGuardrailStoppedUnits` / `hostGuardrailRestoredUnits`; the service-backed read model preserves those fields, the managed-host workspace exposes compact latency and service-health signals plus detailed unit state and guardrail stopped/restored unit evidence in the host drawer, and red high-latency samples plus required service failures are projected into the active system-alert lifecycle.
- Xray customer-node read models only project runtime-supported inbound protocols: VLESS, VMess, Trojan, and Shadowsocks. Explicit unsupported protocol requests are not projected as customer nodes, matching the runtime artifact compiler.
- Subscription client read models and public subscription responses now project current usage and generated node counts from the selected local Xray clients, so runtime-backed customer subscriptions do not rely on static `usedTrafficGb` or `generatedNodeCount` task metadata. Public subscription downloads are rejected with `subscription.quota_exceeded` while the subscription-user quota is exhausted and resume after a successful `quota.reset` baseline.
- Subscription bundle read models now derive global and export-profile scoped bundles from the current subscription sources, synced inventory nodes, and export profiles; generated node counts and health scores are recomputed from that live read model instead of static seed bundle rows.
- External subscription source sync now restricts remote fetches to `http` / `https`, blocks localhost and private/local IP literals plus hostnames that resolve to private/local IPs before remote read, pins the default production request to the verified public DNS address while preserving the original Host / HTTPS SNI, writes a persisted non-sensitive sync lease before remote read so concurrent instances are rate-limited by source lease / refresh interval, supports an optional host egress allowlist, applies per-source request timeout and response body limits before parsing, enforces provider-account UTC-day fetch and response-byte budgets from persisted subscription source read models, and falls back to service defaults when a source does not override them. Unsupported protocols, allowlist misses, blocked targets, timeouts, oversized responses, budget-limited syncs, and upstream failures are projected as failed sync results, rate-limit responses, or audit-chain entries according to where the sync stops.
- External subscription source sync now detects cross-source duplicate nodes with the source dedupe policy, marks the later source `warning`, and persists non-sensitive sync warning codes for the source table.
- External subscription source sync now appends `subscription.source.synced` or `subscription.source.sync_failed` audit hash-chain entries with before/after source state, node counts, and warning codes.
- Subscription inventory nodes now expose optional runtime status, customer, host, used-traffic, quota, and expiry metadata. Custom routing rules support `host:`, `agent:`, `status:`, `customer:`, and `traffic:` tokens in addition to protocol, region, source, tag, name, and server filters.
- External subscription sync now parses provider `subscription-userinfo` headers, stores upload, download, total quota, and expiry snapshots on the subscription source read model, and surfaces the latest snapshot in the external source table.
- The Agent now evaluates Xray client monthly quota and expiry guardrails during telemetry collection. Disabled clients are filtered from the generated inbound fragment, the Xray config is rebuilt, and telemetry reports `runtimeDisabledByPolicy` plus `guardrailReason`; when a later sample reports policy recovery, Master read models re-enable clients that were disabled by runtime guardrails.
- `/events/v1/tasks` now supports cursor-resumable snapshots with the `cursor` query parameter or standard `Last-Event-ID` header before continuing with durable task/audit read-model tailing. Task status events replay the persisted audit-chain history for `queued`, `running`, `succeeded`, `failed`, `retrying`, `rolled_back`, and `canceled` transitions instead of relying only on the latest task row. `/events/v1/system-alerts` uses the same cursor pattern for active system-alert snapshots, emits a new snapshot when the derived alert fingerprint changes, and reconciles active alerts against a persisted active/resolved lifecycle record. Service-backed snapshot/list reads also rebuild managed-host, subscription, and forwarding read models from durable state before returning, so sibling sqlite-backed panel instances converge without restart. The installer-generated Nginx panel proxy keeps `/events/v1/*` unbuffered and explicitly returns `text/event-stream`.
- Service-backed audit logs include a SHA-256 hash chain and can be verified by the adapter. The browser mock adapter keeps its portable test hash and is not production tamper resistance.

## Backend Service Kernel Added

`src/server/control-plane` now contains a tested service/repository boundary that is ready to be replaced with a durable database implementation:

- `control-plane-repository.ts` defines the transaction-facing repository contract.
- `in-memory-control-plane-repository.ts` provides a copy-on-write transactional in-memory implementation for tests.
- `file-control-plane-repository.ts` provides a single-process file-backed repository for local durable state. It preserves the in-memory transaction contract and persists tasks, audit logs, command outbox entries, Agent events, idempotency records, forward rules, and permission grants across backend restarts.
- `control-plane-service.ts` implements task creation, denied audit persistence, idempotency replay/conflict handling, resource-version conflict handling, command outbox creation, Agent ACK/result state transitions, and Agent event `eventId` deduplication.
- `control-plane-service.ts` also implements command lease/retry/deadline-expiry semantics for Agent HTTP pull mode.
- `control-plane-service.ts` compiles task operations into semantically correct Agent command envelopes for apply, reload, and rollback flows, and persists config revisions, preflight plans, and runtime snapshots into the repository.
- `control-plane-service.ts` applies Agent result events to runtime release read models, giving the UI/API a lifecycle view that no longer has to infer release state from command payloads.
- `control-plane-service.ts` also persists Agent install/runtime credentials as token digests, redeems install tokens through `registerAgent`, retains non-sensitive registration metadata for managed-host projection, audits runtime credential issuance, lists sanitized credential summaries, revokes credentials with audit, and resolves only active runtime credentials for service-backed Agent poll/event authentication.
- `agent.delete` tasks require a successful Agent result before they can be marked succeeded. After the delete command succeeds, the service revokes every active runtime credential for that Agent inside the same transaction and appends `agent.credential.revoked` audit records, so a removed host cannot keep authenticating with a previously issued runtime token while still being able to poll for the delete command.
- The browser mock adapter keeps the same Agent registration boundary for contract parity: it stores an internal full install-token digest, rejects forged tokens that only match the displayed `tokenPrefix`, and strips the internal digest from public credential lists and audit entries.
- `GET /api/v1/config-revisions`, `GET /api/v1/preflight-plans`, and `GET /api/v1/runtime-snapshots` expose the release read models for operator diagnostics and future release dashboards.
- `control-plane-service.ts` also enforces a first-pass operation permission matrix (`operate`, `configure`, `grant`) before task creation, filters expired grants out of authorization, scopes `permission.grant` / `permission.revoke` checks by `permissionChange.resourceType`, and persists authorized `permission.grant` changes into the repository.
- `control-plane-service.test.ts` covers task/audit/idempotency/outbox atomicity, Agent event state progression, RBAC denial/allow paths, and permission grant persistence.
- `src/services/api/service-backed-control-plane-api.ts` adapts the service kernel into the existing `ControlPlaneApi` interface, so `createHttpControlPlaneServer()` can run against the service path instead of the mock adapter.
- `src/services/api/http-control-plane-auth.test.ts` covers optional operator and Agent bearer-token gates, sensitive-read protection, token-bound Agent identity, and token boundary separation.
- `src/services/api/http-control-plane-client.ts` can attach separate operator and Agent bearer tokens so the frontend can talk to an auth-enabled local backend in HTTP mode.
- `src/services/api/http-control-plane-service-api.test.ts` proves the HTTP server can create service-backed tasks, surface service-backed audit/outbox state, enforce RBAC denial, persist permission grants, and let Agent ACK/result events advance task state.
- `src/server/control-plane/create-service-backed-control-plane.test.ts` proves the service-backed HTTP factory starts with seeded inventory and empty task/audit state, and that file storage restores mutation state across backend restarts.

The Vite frontend still defaults to the mock API for local UX stability. The next backend step is to replace the file repository with a production database and extend operator identity with durable users, MFA/OIDC, and external identity/session integrations.

## Dependency Security Note

`npm audit --omit=dev` currently reports zero production dependency vulnerabilities. Full `npm audit` reports Vite/Vitest/esbuild development-server advisories that require a breaking Vite upgrade according to npm. Production deployments must not expose the Vite dev server; the dev-toolchain upgrade remains a tracked follow-up.

## Not Yet Production Backend

This adapter is not a production backend by itself. It wraps a service-backed `ControlPlaneApi` implementation with selectable `memory` or `file` repository storage and optional bootstrap bearer-token gates. It is suitable for frontend integration, contract testing, local durable demos, and early backend shape validation.

The file repository is still a single-node development persistence layer, not a production database. It assumes one backend process owns the state file, does not provide multi-replica locking, migrations, encryption-at-rest, backup/restore policy, or high availability. The SQLite repository now refuses unsupported schema metadata so a newer database is not silently opened or downgraded by an older build, but full forward migrations and HA-safe database ownership remain production backend work. Service-backed Agent log chunks are pruned by retention age and per-Agent cap, retained chunks can be exported as JSONL/JSON through `GET /api/v1/agent-log-chunks:export`, and retention-pruned chunks are compacted into queryable/exportable UTC-day archive summaries through `/api/v1/agent-log-archives` plus `/api/v1/agent-log-archives:export` without retaining full pruned text. Traffic rollups are pruned by retention age and per `dimension + agentId + subjectId` scope cap, retained rollups can be exported as JSONL/JSON through `GET /api/v1/traffic-rollups:export`, and removed raw samples are compacted into queryable/exportable daily buckets. Active retention policies are exposed and edited through `GET/PATCH /api/v1/agent-log-retention-policy`, `GET/PATCH /api/v1/traffic-rollup-retention-policy`, snapshots, the execution workspace where applicable, and the dashboard traffic history retention panel for traffic rollups. Runtime-edited retention overrides are persisted in the control-plane store, audited as `agent.log_retention.updated` or `traffic.rollup_retention.updated`, and applied to subsequent writes; broader database retention and object-storage archival connectors are still required. The service-backed audit hash chain uses SHA-256 and can write external JSONL hash anchors, but tamper resistance still depends on storage-level append-only controls, retention/export policy, and stronger external anchoring.

The bearer-token and signed-cookie session layer is a hardening slice, not the final identity platform. Cookie-backed mutations require CSRF tokens, server-side operator sessions are revocable, and session issue, revoke/logout, and expiry write audit-chain evidence. Production V1 still needs durable user records, MFA/OIDC or JWT integration, and richer audit-visible external identity and API-token lifecycle events.

Production V1 still needs code for:

- Production database storage for tasks, audit logs, idempotency records, command outbox, agent events, permission grants, config revisions, preflight plans, runtime snapshots, and telemetry samples.
- Full authentication for operators and agents beyond the current bootstrap bearer-token registry.
- Agent identity registration, credential rotation, and poll/event authentication.
- Database-grade transactional task/audit/idempotency/outbox writes, including schema migrations, lock semantics, and retention policies.
- Full outbox dispatcher operations beyond the current lease/retry/session/deadline/background-sweep slice: HA-safe sweep coordination, lease owner recovery, and command deduplication across transports.
- Richer health-probe SLO/alert policy, external identity/API-token lifecycle integration, and external log chunk storage/export controls.
- Real cryptographic audit hashing/signing and export verification.
- Runtime preflight execution, apply, verify, commit, and rollback.
- External runtime artifact storage, real cryptographic signing, live snapshot inventory, health verification, commit tracking, and automatic rollback policy.
- Remaining quota enforcement scopes and external traffic archival/export retention controls.
- Prometheus histogram buckets or external time-series retention for latency/duration by operation/module, distributed trace export, external alert routing, and production alerting.

## Verification

Focused adapter coverage:

```powershell
npm.cmd test -- src/services/api/openapi-contract.test.ts src/services/api/api-contract.test.ts src/services/api/http-control-plane-server.test.ts src/services/api/http-control-plane-client.test.ts src/services/api/create-control-plane-api.test.ts src/services/mock/mock-api.test.ts
```

Full project verification:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
```
