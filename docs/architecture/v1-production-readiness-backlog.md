# OU-UI Next V1 Production Readiness Backlog

Last updated: 2026-06-05

This backlog separates the current frontend + mock-backed HTTP adapter from the remaining production V1 backend work.

## Must Add Code

Persistence:

- Replace the current tested in-memory/file repositories in `src/server/control-plane` with a production database store for `DeployTask`, `AuditLog`, idempotency records, `CommandOutboxItem`, Agent events, permission grants, config revisions, preflight plans, runtime snapshots, and telemetry samples.
- Preserve the current service contract: task creation, audit write, idempotency record, and command outbox insert must stay in one transaction.
- Add migrations, lock semantics, and retention policies. The installer CLI now provides local single-node SQLite backup/restore commands, but production still needs documented replicated backup/restore procedures.

Task outbox:

- Build on the current HTTP-pull lease/retry slice with automatic command timeout sweep, ACK timeout, result timeout, dead-letter states, lease owner/session tracking, and transport-specific dispatchers.
- Keep at-least-once delivery semantics and require Agent-side idempotency by `commandId` and `configRevision`.

Agent runtime:

- Authenticate `/agent/v1/poll` and `/agent/v1/events`.
- Keep the service-level `eventId` idempotency and the service-backed `agentId + sessionId + seq` monotonic replay guard now covered by `src/server/control-plane/control-plane-service.test.ts`.
- Bind `sessionId` into HTTP-pulled command envelopes, persist poll-side `lastSeenCommandSeq` as Agent session progress, and retain safe `leaseOwnerId` / `leaseSessionId` values on command outbox entries for production incident tracing.
- Store heartbeat, telemetry samples, result events, log chunks, and Agent session liveness read models. Service-backed host lists now derive `online` / `degraded` / `offline` from heartbeat or telemetry age, host telemetry read models derive sampling-gap state from the last telemetry sample timestamp, and active sampling gaps route into `/api/v1/system-alerts`, `/events/v1/system-alerts`, and the dashboard. Log chunks are retrievable through the protected `/api/v1/agent-log-chunks` read API, and service-backed writes now prune retained log chunks by age and per-Agent cap. Production still needs external durable log storage, export, and operator-visible retention controls.
- The published Agent runtime script now sends heartbeat after each poll, samples ping/hardware/disk/network/traffic telemetry on the configured 30-second cadence, queues automatic heartbeat/telemetry events for retry when Master delivery fails, executes explicit `health` and `telemetry` commands, and returns failed results for unsupported command types instead of acknowledged no-ops.
- Keep the service-level tests that reject Agent ACK/result events observed after command deadline, expire the command outbox entry, fail the related queued/running/retrying task, and write a task failure audit. The service-backed Control Plane now also runs this sweep as a configurable background job in each HTTP server instance.
- Continue hardening Agent health probes with richer module-specific checks, SLO thresholds, and alert routing.
- Continue hardening durable Agent registration with explicit rotation APIs and stronger Agent identity material.

Audit ledger:

- Keep service-backed audit-chain hashing on real SHA-256. The browser mock adapter remains non-cryptographic and should not be treated as tamper resistance.
- Repository audit append paths now reject duplicate `auditLog.id` values, and file-backed state loading rejects duplicate audit IDs before serving the ledger. Production still needs storage-level append-only controls.
- `/api/v1/audit-logs:verify` now verifies both the persisted audit chain and exported audit log arrays submitted by operators. Production still needs optional external anchoring.
- Ensure rejected auth/RBAC/idempotency/resource-version/quota requests write `audit.denied`; Operator protected-route authentication failures, Agent registration failures, and Agent poll/events authentication failures or identity mismatches now emit sanitized denied audit evidence.

RBAC:

- Replace the current bootstrap bearer-token registry with real session/OIDC/JWT operator identity and durable Agent credential records.
- Continue deriving actor, operator group, resource group, and agent identity from authenticated credentials, not from trusted client headers.
- Keep the service-level operation-to-permission matrix, high-risk confirmation policy, and the `permission.revoke` last-administrative-path guardrail now covered in `src/server/control-plane/control-plane-service.test.ts`, then expand them with resource-type-specific checks.

Runtime release:

- Build on the current semantic Agent command compiler, repository-backed config revision / preflight plan / runtime snapshot read models, and Agent-result-driven release lifecycle updates.
- Inline runtime artifacts now carry a SHA-256 checksum over canonical artifact JSON, and the published Agent verifies that checksum plus `sig-v1` digest before taking a local snapshot, running module preflight, or writing runtime files.
- Runtime preflight read models now include artifact integrity, config schema, port conflict, runtime dependency availability, and rollback snapshot checks; failed Agent results mark the matched check instead of failing every critical check blindly.
- Master now verifies successful apply/reload/rollback results against the expected `appliedConfigRevision`; missing or mismatched revisions are normalized to failed results and marked as result verification failures.
- Port forwarding allocation now requires Agent-result proof from every target command; Agent-reported port binding conflicts project the forwarding rule and binding as `conflict`, telemetry no longer promotes deploying bindings to allocated, and manual task transitions cannot mark forwarding/tunnel runtime tasks succeeded.
- Agent port-forwarding apply/remove now snapshots and clears stale TCP and UDP systemd units for the service before rebuilding the latest protocol set, so protocol edits and deletes do not leave old forwarding services running.
- Deleting the final Xray customer node now records the removed `ou-ui-xray.service` unit in local revision changed files after stopping the runtime, keeping convergence and rollback evidence aligned.
- Xray Reality customer-node metadata now separates server-side `privateKey/target/serverNames/shortIds` from client subscription `pbk/fp/sid` parameters across UI preview, API contract, runtime artifact, and share URI generation.
- Public Sing-box subscriptions now emit VLESS flow, client-side Reality TLS/uTLS, and WS/gRPC/HTTPUpgrade transport settings without leaking server-side Reality private keys.
- Implement real compile -> diff -> preflight -> snapshot -> apply -> verify -> commit.
- Implement durable rollback tasks, runtime snapshot inventory, artifact storage, and health-based rollback policy.
- Add module adapters for Xray, GOST, port forwarding, and kernel tuning with allowlisted operations.

Quota:

- Aggregate ingress/egress counters from Agent telemetry. Managed-host, forwarding, Xray customer-node, and subscription-user read models now project current-period usage from Agent samples; Xray guardrail-only samples keep quota/expiry status moving when StatsService is unavailable without overwriting the last valid counters, telemetry also appends host, forwarding, and Xray client counters into durable traffic rollups, the dashboard aggregates those retained samples by managed host / forwarding rule / customer node, `/api/v1/quota-policies` derives live managed-host / customer-node / subscription-user / forwarding-account / forwarding-rule quota views for the security workspace, and host telemetry snapshots expose sampling-gap state with active system alerts over REST, snapshot, dashboard, and SSE. Active alerts now reconcile against a durable active/resolved lifecycle record. Production still needs alert notification channels, rollup compaction, and retention/export policy.
- `/api/v1/customers` now derives the customer directory from live customer-node, subscription-user, and port-forwarding read models rather than fake customer seeds. Service-backed and mock adapters dedupe same-name customers across sources, preserve non-Latin customer names as distinct identities, and aggregate usage as `max(customer-node usage, subscription usage) + forwarding usage`.
- Forward-rule and forwarding-account quotas now auto-create system actor `forward.pause` / `forward.resume` tasks from live quota transitions and reuse the normal Agent apply/outbox chain for durable evidence. Subscription-user quotas now block public subscription downloads with `subscription.quota_exceeded` until `quota.reset` re-baselines usage. Tunnel scope enforcement remains production backlog.
- Create system actor tasks for the remaining automatic quota enforcement scopes.

Observability:

- The production HTTP entrypoint now emits JSON structured logs for request completion/errors, task lifecycle events, command dispatch, Agent poll/events, credential changes, and subscription-source syncs with `requestId`, `taskId`, `commandId`, `agentId`, and W3C `traceparent` context. Production still needs external log aggregation, retention, alerting, and distributed trace export.
- `/api/v1/observability-metrics` now exposes task state totals, task completion latency, rollback counts, command outbox backlog/lease/overdue/dead-letter counts, ACK/result latency, Agent offline/degraded counts, active alert severity counts, audit-chain verification state, denied audit counts, and quota-exceeded audit counts. `/metrics` renders that snapshot as protected Prometheus text gauges for external scraping. Production still needs richer apply-duration histograms by operation/module, quota-enforcement time series, audit write-failure counters, and alert routing.
- Keep the protected `/events/v1/tasks` and `/events/v1/system-alerts` SSE streams for task/audit and active alert state. They now send `cursor` / `Last-Event-ID` resumable snapshots, replay the full persisted task-status chain from audit evidence, keep the connection open for durable read-model tailing or derived alert fingerprint changes, and persist active/resolved system-alert lifecycle evidence across restarts. Service-backed snapshot/list reads also rebuild managed-host, subscription, and forwarding read models from durable state before returning, so sibling sqlite-backed panel instances stay converged without restart. Production still needs external alert notification fan-out.

## Can Be Documented Before Coding

- Storage schema and migration plan.
- Agent registration, identity, credential rotation, and revocation.
- Outbox delivery semantics and retry policy.
- RBAC matrix by operation, resource type, resource group, and required permission.
- Runtime release protocol for artifact URI, checksum, signature, preflight, snapshot, health verification, and rollback.
- Production SLO and alert thresholds.

## Current Risks

- The frontend still defaults to the mock API for UX stability; use `VITE_CONTROL_PLANE_MODE=http` to point it at the service-backed HTTP control plane.
- The service-backed HTTP adapter is wired to `src/server/control-plane` and supports `memory`, single-process `file`, or SQLite-backed repository storage. SQLite storage now persists the current control-plane repository state inside a transactional database file, can import the legacy JSON state file on first boot, and gives local deployments WAL-backed commit semantics without rewriting the service contract.
- The SQLite repository still stores the current control-plane state as one transactional JSON document; installer maintenance commands now provide local single-node SQLite backup/restore and pre-restore snapshots, but production still needs a more normalized schema, HA replication strategy, explicit migrations, retention management, and stronger crash-recovery / storage controls.
- The HTTP adapter can enforce optional bootstrap bearer tokens and signed HttpOnly operator sessions for operator mutations and sensitive reads. Session-backed `/api/v1` mutations now require `X-CSRF-Token`, while bearer-token automation without a session cookie and `/agent/v1/*` Agent routes remain outside the CSRF requirement. Protected operator-route authentication and CSRF failures write sanitized denied audit evidence, with per-source failure throttling reserved for authentication failures. Installer nginx templates verify the browser session with `auth_request` before injecting the backend token, but this is still not a full identity platform.
- Bootstrap tokens and operator credentials are configured from environment variables and are not yet durable, hashed at rest, rotated, revoked through the panel, protected by MFA/OIDC, or fully audited as login/token lifecycle events.
- `/agent/v1/poll` and `/agent/v1/events` can authenticate Agent bearer tokens, bind them to `agentId`, and audit authentication failures or identity mismatches without token material. Service-backed poll/event handling now persists Agent events, records heartbeat/session liveness, binds leased commands to the polling `sessionId`, records the safe lease owner/session read-model fields, records `lastSeenCommandSeq`, rejects stale events within the same `agentId + sessionId` sequence window, and rejects deadline-expired ACK/result events while expiring the outbox command, failing the related task, and writing a task failure audit.
- Service-backed Agent enrollment now exchanges the one-time install token through `/agent/v1/register`, persists only credential digests, revokes the install credential after redemption, appends sanitized runtime credential issuance audit evidence, appends sanitized `audit.denied` evidence for failed registration attempts, projects the registered host as `provisioning` with non-sensitive registration metadata, surfaces that metadata on the managed-host card before heartbeat/telemetry arrives, and requires a `purpose: runtime` credential for `/agent/v1/poll` and `/agent/v1/events`.
- Operator-visible Agent credential inventory and revocation now exist through `/api/v1/agent-credentials` and `/api/v1/agent-credentials/{credentialId}/revoke`; public responses omit raw token material and `tokenHash`, and revocation writes an audit-chain event.
- Runtime credentials are now bound to the registration `sessionId`; service-backed `/agent/v1/poll` and `/agent/v1/events` reject token reuse from a different or missing session.
- Production still needs stronger device identity material such as mTLS/JWT key rotation, richer health-probe SLO/alerting policy, HA-safe command timeout sweep coordination, dead-letter retention, and external durable log chunk storage/export controls.
- Service-backed audit hash-chain verification now uses SHA-256, but production tamper resistance still needs append-only storage controls, export retention, and optional external anchoring. Browser mock verification remains test-only.
- Runtime apply tasks now persist config revision, preflight plan, and runtime snapshot read models; Agent results advance those records through applied/failed/verified/restored lifecycle states. Inline artifacts are materialized for host-agent, Xray inbound, and port-forwarding apply paths, Agent apply rejects checksum/signature mismatches before snapshot/preflight, Master rejects applied revision mismatches, and failed health summaries are retained on config revisions. External artifact storage, real cryptographic signing, durable snapshot inventory, GOST/kernel adapters, and health-based rollback policy are still production backlog.
- SSE task events now return protected task-status history and audit-summary snapshot events with `cursor` / `Last-Event-ID` resume support, replaying the persisted task-status chain from audit evidence before continuing with durable tailing. SSE system-alert events return protected active-alert snapshots with the same resume pattern and publish a new snapshot when derived alert state changes. Production still needs external notification fan-out and multi-instance fan-out for system-alert snapshots.
- Service-backed external subscription sync now restricts remote fetches to `http` / `https`, blocks localhost and private/local IP literals plus DNS-resolved private/local targets, pins the default production request to the verified public DNS address while preserving the original Host / HTTPS SNI, writes a persisted non-sensitive sync lease before remote read so concurrent instances are rate-limited by source lease / refresh interval, enforces a provider-host concurrent fetch budget from persisted sync leases, enforces an optional host egress allowlist before remote read, applies per-source request timeout and response body limits, and writes allowlist-miss/blocked-target/timeout/oversize/unsupported-protocol outcomes into the sync failure state and audit hash chain. Production still needs provider-account quota/cost budgets beyond host-level concurrency.
