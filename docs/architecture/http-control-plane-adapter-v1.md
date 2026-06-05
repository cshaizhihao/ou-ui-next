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
- `OU_UI_CONTROL_PLANE_STORAGE=sqlite`: persists the current control-plane repository state into `OU_UI_CONTROL_PLANE_SQLITE_FILE` inside a SQLite database file, enables WAL-backed transactional commits, and can import a legacy JSON state file from `OU_UI_CONTROL_PLANE_LEGACY_STATE_FILE` when the database is first created.
- `OU_UI_SUBSCRIPTION_SOURCE_EGRESS_ALLOWLIST`: optional comma-separated external subscription source host allowlist. Entries may be exact hosts, URL values whose host will be used, or suffix wildcards such as `*.trusted.example.com`. When set, external subscription sync fails before DNS and fetch if the source host does not match.

Production installs that use SQLite storage also expose `ou-ui backup-state` and `ou-ui restore-state <backup-path>` so operators can create local snapshots and restore them through the management CLI without hand-copying the database file.

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

Production installer nginx templates expose the frontend login page without browser Basic Auth, keep the backend operator token server-side, and use `auth_request` to verify the HttpOnly session before proxying browser `/api`, `/events`, or `/metrics` requests with the backend bearer token. The Vite frontend no longer reads or embeds the generated login password.

Repeated failed operator authentication attempts are throttled per source by a default 60-second / 20-failure window. Attempts inside the window still return `401 unauthorized` and append sanitized `audit.denied` evidence; the first over-limit attempt returns `429 operator_auth.rate_limited` and appends one throttle audit entry, and later attempts in the same window return `429` without adding more audit rows.

When Agent auth is configured, `/agent/v1/poll` and `/agent/v1/events` require `Authorization: Bearer <agent-token>` and the token-bound `agentId` must match the request body and every submitted event.

Service-backed Agent enrollment uses `POST /agent/v1/register` to exchange the short-lived install token for a persisted runtime Agent credential. The install credential is revoked after redemption, registration version/platform/capability metadata is retained for the managed-host read model, the runtime credential issuance is appended to the audit chain without raw token material, and service-backed poll/event routes accept `purpose: runtime` credentials only.

Operators can inspect sanitized credential records with `GET /api/v1/agent-credentials`, revoke a credential with `POST /api/v1/agent-credentials/{credentialId}/revoke`, and rotate active runtime credentials with `POST /api/v1/agent-credentials/{credentialId}/rotate`. The Security Policy workspace renders only `tokenPrefix`, purpose, status, session, and audit metadata; it never renders raw token material or `tokenHash`.

Runtime Agent credentials are bound to the `sessionId` submitted at registration. Service-backed `/agent/v1/poll` and `/agent/v1/events` reject the credential when the request or event session does not match that bound session.

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
- Agent credential list/revoke/rotate APIs expose sanitized credential summaries to operators; revocation writes `agent.credential.revoked` into the audit hash chain, rotation writes `agent.credential.rotated`, and revoked credentials become unusable for subsequent Agent authentication.
- Runtime Agent credentials are bound to the registration session and reject mismatched or missing session identities on service-backed poll/event requests.
- Agent poll/event authentication failures and identity mismatches append sanitized `audit.denied` evidence without bearer token material.
- Operator bearer authentication failures on protected REST, SSE, and Prometheus routes return `401 unauthorized` promptly and append sanitized `audit.denied` evidence without bearer token material, with per-source throttling to prevent unbounded audit-chain growth. Denied-audit appends read the previous audit hash through the active repository transaction, so sqlite-backed production deployments do not self-block on the serialized repository queue while handling auth failures. If a denied-audit append fails, the HTTP server keeps the original auth response, emits an `audit.write_failed` structured log event, and increments the runtime audit write-failure metric.
- Agent poll accepts `sessionId` and `lastSeenCommandSeq`, leases commands with the polling session bound into the `AgentCommandEnvelope`, records `leaseOwnerId` / `leaseSessionId` on the command outbox read model, and records an Agent session liveness read model in the service-backed repository.
- Agent event intake persists events, deduplicates by `eventId`, records heartbeat/session liveness, and rejects stale events inside the same `agentId + sessionId` monotonic sequence window.
- Service-backed Agent read models derive `online`, `degraded`, and `offline` status from the most recent heartbeat or telemetry signal using the configured 30-second probe cadence. Host telemetry snapshots separately derive sampling-gap state from `telemetry.reportedAt` and red high-latency state from the configured latency thresholds; fresh heartbeat events do not clear stale telemetry samples, and active Agent offline state, gaps, or high-latency samples project into the system alert read model.
- The published Agent runtime script sends heartbeat after each poll, samples ping/hardware/disk/network/traffic telemetry on the configured 30-second cadence, queues automatic heartbeat/telemetry events for retry when Master delivery fails, executes explicit `health` and `telemetry` commands, and reports unsupported command types as failed results.
- Idempotency conflicts write `audit.denied`.
- Stale `If-Match` on supported resources writes `audit.denied`.
- Permission overreach for `permission.grant` writes `audit.denied`.
- High-risk task mutations require matching `riskConfirmation.operation` and `riskConfirmation.targetId`; missing or mismatched confirmation writes `audit.denied` with `high_risk_confirmation.required`.
- `permission.revoke` rejects changes that would remove the final active `grant` permission path for a resource and writes `audit.denied`.
- Repository audit appends reject duplicate `auditLog.id` values, and file-backed state loading rejects duplicate audit IDs before serving the ledger.
- `GET /api/v1/audit-logs:verify` verifies the persisted audit chain; `POST /api/v1/audit-logs:verify` accepts an exported `auditLogs` array and verifies it without mutating server state.
- Agent ACK moves a queued task to running.
- Agent result moves a running task to succeeded or failed.
- Forwarding and tunnel runtime tasks cannot be manually transitioned to `succeeded`; success must come from Agent result events.
- Command outbox entries can be created by task mutations or explicit `issueAgentCommand`.
- Agent polling leases eligible commands, marks them `dispatched`, increments `attempts`, records `leaseOwnerId`/`leaseSessionId` plus `leasedAt`/`leaseExpiresAt`, suppresses duplicate in-flight polls, and retries after lease expiry until the command deadline expires. When Agent auth is enabled, the lease owner is the authenticated credential ID rather than raw token material.
- Deadline-expired commands are marked `expired`, linked queued/running/retrying tasks are failed with `command.deadline.expired`, and a task failure audit is appended.
- Agent ACK/result events observed at or after command deadline are rejected with `agent_event.command_deadline_expired`; the stale event does not advance the task to succeeded.
- The service-backed Control Plane starts a configurable command timeout sweep job by default. It runs the same deadline, ACK timeout, and result timeout logic as the protected manual sweep API. Production service instances use the real process clock for task timestamps, outbox deadlines, and sweep observations; tests inject a deterministic clock explicitly.
- Runtime command compilation now differentiates `apply`, `reload`, and `rollback` Agent command envelopes. Apply commands reference persistent config revision, preflight plan, and runtime snapshot records that are queryable through the HTTP API.
- Runtime apply checksums are generated from the canonical inline artifact JSON. The published Agent verifies checksum and `sig-v1` digest before creating the local snapshot, running module preflight, or writing runtime files.
- Agent result events now advance runtime release read models in the same repository transaction as task/outbox/audit updates: successful apply marks config revisions `applied`, preflight plans `passed`, and snapshots `verified`; failed apply marks config/preflight records `failed`, retains failed health summaries, and maps the failure reason to the matching preflight check; successful apply/reload/rollback results with missing or mismatched `appliedConfigRevision` are normalized to failed result-verification records; successful rollback marks the referenced snapshot `restored`.
- Port forwarding read models now require Agent-result verification before allocation: create/update/apply tasks project as `deploying` until every target Agent command completes successfully with the expected config revision, delete tasks remain `releasing` until verified, and telemetry samples only update traffic/quota counters.
- Managed-host and port-forwarding telemetry now carries `trafficBillingPeriod`; the service-backed and mock adapters project current monthly usage from `monthlyResetDay`, ignore previous-period traffic samples, and reset stale read-model usage at snapshot time without deleting retained Agent events.
- Agent telemetry samples now append host, forwarding, and Xray client counter records into `TrafficRollup` history. The service-backed repository persists the rollup read model and exposes it through `/api/v1/traffic-rollups` and snapshots; the dashboard aggregates those retained samples by managed host, forwarding rule, and customer node; and `/api/v1/agents`, `/api/v1/system-alerts`, snapshots, and `/events/v1/system-alerts` expose derived sampling-gap fields and active alert state for each affected host.
- `/api/v1/quota-policies` now aggregates live quota read models from managed hosts, Xray customer nodes, subscription users, forwarding accounts, and forwarding rules instead of returning only static seed rows. The security workspace uses those derived policies to surface current-window usage, billing direction, reset cadence, and guardrail disable reasons by scope.
- `/api/v1/customers` now exposes a decoupled customer directory derived from customer nodes, subscription identities, and port-forwarding owner names. Service-backed and mock adapters dedupe same-name customers across sources, keep Chinese/non-Latin customer names distinct, and aggregate traffic as `max(customer-node usage, subscription usage) + forwarding usage` so local Xray subscription traffic is not double-counted. The frontend `客户管理` route consumes this read model directly and shows customer source coverage, resource counts, quota state, traffic, expiry, and latest activity outside the managed-host workspace.
- `POST /api/v1/quota-policies/{quotaPolicyId}/reset` now creates real `quota.reset` tasks: it records before/after audit snapshots, zeros the matching quota read model immediately, and re-baselines later Agent telemetry and subscription-user public output so pre-reset counters are not re-counted.
- Forward-rule and forwarding-account quota enforcement now create system actor `forward.pause` and `forward.resume` tasks from live quota transitions. Service-backed and mock adapters both reuse the existing Agent apply/outbox path so automatic disable/recovery leaves durable task and audit evidence instead of only flipping read-model flags.
- `/api/v1/observability-metrics` returns a protected operator diagnostics snapshot derived from current tasks, command outbox, Agent liveness, active system alerts, system-alert webhook notification queue state, and audit-chain state. It covers task status totals, completion latency, rollback counts, command backlog/lease/overdue/dead-letter counts, ACK/result latency, Agent offline/degraded counts, alert severity and kind counts, webhook retry/dead-letter counts, audit validity, denied audit counts, quota-exceeded audit counts, and HTTP-observed audit write-failure counts.
- `/metrics` is protected by the same operator bearer-token boundary and renders the current observability snapshot as Prometheus text gauges for external metrics scraping.
- The system-alert lifecycle derives Agent offline alerts from the service-backed liveness read model, so stopped Agents are visible through `/api/v1/system-alerts`, snapshots, `/events/v1/system-alerts`, metrics kind counts, and configured webhook fan-out.
- The system-alert lifecycle now derives command outbox overdue and dead-letter alerts from the durable outbox read model, so stalled Agent delivery is visible through `/api/v1/system-alerts`, snapshots, `/events/v1/system-alerts`, metrics kind counts, and configured webhook fan-out.
- Live quota policies in `exceeded` or `disabled_by_quota` state now derive quota-exceeded system alerts with scope, usage, limit, guardrail, and runtime-disabled metadata, sharing the same REST/snapshot/SSE/metrics/webhook lifecycle.
- The production HTTP entrypoint injects a JSON structured logger. It emits request completion/error events plus task, command, Agent poll, Agent events, credential, and subscription-sync operational events with `requestId`, W3C `traceparent` context, `taskId`, `commandId`, `agentId`, and non-sensitive lifecycle fields.
- Xray telemetry now accepts `xrayClientCounters`; the Agent stores Xray client profiles beside applied inbounds, enables StatsService in the managed Xray config, baselines per-client monthly uplink/downlink counters, and projects current client usage into `XrayInbound.clients[].usedTrafficBytes`. When StatsService is unavailable, the Agent emits `source: xray-guardrail` samples so quota/expiry state still reaches the Master without clobbering the last valid traffic counters.
- Agent host telemetry now accepts Linux load averages, latency bands, and sanitized runtime service health rows for the Agent, Xray, and port-forwarding systemd units. The service-backed read model preserves those fields, the managed-host workspace exposes compact latency and service-health signals plus detailed unit state in the host drawer, and red high-latency samples plus required service failures are projected into the active system-alert lifecycle.
- Xray customer-node read models only project runtime-supported inbound protocols: VLESS, VMess, Trojan, and Shadowsocks. Explicit unsupported protocol requests are not projected as customer nodes, matching the runtime artifact compiler.
- Subscription client read models and public subscription responses now project current usage and generated node counts from the selected local Xray clients, so runtime-backed customer subscriptions do not rely on static `usedTrafficGb` or `generatedNodeCount` task metadata. Public subscription downloads are rejected with `subscription.quota_exceeded` while the subscription-user quota is exhausted and resume after a successful `quota.reset` baseline.
- Subscription bundle read models now derive global and export-profile scoped bundles from the current subscription sources, synced inventory nodes, and export profiles; generated node counts and health scores are recomputed from that live read model instead of static seed bundle rows.
- External subscription source sync now restricts remote fetches to `http` / `https`, blocks localhost and private/local IP literals plus hostnames that resolve to private/local IPs before remote read, pins the default production request to the verified public DNS address while preserving the original Host / HTTPS SNI, writes a persisted non-sensitive sync lease before remote read so concurrent instances are rate-limited by source lease / refresh interval, supports an optional host egress allowlist, applies per-source request timeout and response body limits before parsing, and falls back to service defaults when a source does not override them. Unsupported protocols, allowlist misses, blocked targets, timeouts, oversized responses, and upstream failures are projected as failed sync results and audit-chain entries.
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
- `GET /api/v1/config-revisions`, `GET /api/v1/preflight-plans`, and `GET /api/v1/runtime-snapshots` expose the release read models for operator diagnostics and future release dashboards.
- `control-plane-service.ts` also enforces a first-pass operation permission matrix (`operate`, `configure`, `grant`) before task creation, and persists authorized `permission.grant` changes into the repository.
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

The file repository is still a single-node development persistence layer, not a production database. It assumes one backend process owns the state file, does not provide multi-replica locking, migrations, encryption-at-rest, backup/restore policy, or high availability. Service-backed Agent log chunks are pruned by retention age and per-Agent cap, and retained chunks can be exported as JSONL/JSON through `GET /api/v1/agent-log-chunks:export`. The active retention policy is exposed and edited through `GET/PATCH /api/v1/agent-log-retention-policy`, snapshots, and the execution workspace. Runtime-edited retention overrides are persisted in the control-plane store, audited as `agent.log_retention.updated`, and applied to subsequent `log_chunk` pruning; broader database retention and external archival sinks are still required. The service-backed audit hash chain uses SHA-256, but tamper resistance still depends on append-only storage controls and retention/export policy.

The bearer-token and signed-cookie session layer is a hardening slice, not the final identity platform. Cookie-backed mutations require CSRF tokens, server-side operator sessions are revocable, and session issue, revoke/logout, and expiry write audit-chain evidence. Production V1 still needs durable user records, MFA/OIDC or JWT integration, and richer audit-visible external identity and API-token lifecycle events.

Production V1 still needs code for:

- Production database storage for tasks, audit logs, idempotency records, command outbox, agent events, permission grants, config revisions, preflight plans, runtime snapshots, and telemetry samples.
- Full authentication for operators and agents beyond the current bootstrap bearer-token registry.
- Agent identity registration, credential rotation, and poll/event authentication.
- Database-grade transactional task/audit/idempotency/outbox writes, including schema migrations, lock semantics, and retention policies.
- Full outbox dispatcher operations beyond the current lease/retry/session/deadline/background-sweep slice: HA-safe sweep coordination, lease owner recovery, and command deduplication across transports.
- Agent credential rotation issuance, richer health-probe SLO/alert policy, and external log chunk storage/export controls.
- Real cryptographic audit hashing/signing and export verification.
- Runtime preflight execution, apply, verify, commit, and rollback.
- External runtime artifact storage, real cryptographic signing, live snapshot inventory, health verification, commit tracking, and automatic rollback policy.
- Quota aggregation, enforcement tasks, and traffic counter gap detection.
- Latency/duration histograms by operation/module, distributed trace export, external alert routing, and production alerting.

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
