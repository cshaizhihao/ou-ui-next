# OU-UI Next V1 Production Readiness Backlog

Last updated: 2026-06-05

This backlog separates the current frontend + mock-backed HTTP adapter from the remaining production V1 backend work.

## Must Add Code

Persistence:

- Replace the current tested in-memory/file repositories in `src/server/control-plane` with a production database store for `DeployTask`, `AuditLog`, idempotency records, `CommandOutboxItem`, Agent events, permission grants, config revisions, preflight plans, runtime snapshots, and telemetry samples.
- Preserve the current service contract: task creation, audit write, idempotency record, and command outbox insert must stay in one transaction.
- Add migrations, lock semantics, backup/restore procedures, and retention policies.

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
- Port forwarding allocation now requires Agent-result proof from every target command; telemetry no longer promotes deploying bindings to allocated, and manual task transitions cannot mark forwarding/tunnel runtime tasks succeeded.
- Implement real compile -> diff -> preflight -> snapshot -> apply -> verify -> commit.
- Implement durable rollback tasks, runtime snapshot inventory, artifact storage, and health-based rollback policy.
- Add module adapters for Xray, GOST, port forwarding, and kernel tuning with allowlisted operations.

Quota:

- Aggregate ingress/egress counters from Agent telemetry. Managed-host, forwarding, and Xray customer-node read models now project current-period usage from Agent samples; Xray guardrail-only samples keep quota/expiry status moving when StatsService is unavailable without overwriting the last valid counters, telemetry also appends host, forwarding, and Xray client counters into durable traffic rollups, and host telemetry snapshots expose sampling-gap state with active system alerts over REST, snapshot, dashboard, and SSE. Production still needs alert notification channels, alert lifecycle persistence, rollup compaction, and retention/export policy.
- Enforce user, tunnel, tunnel-account, and forward-rule quotas.
- Create system actor tasks for automatic quota enforcement.

Observability:

- The production HTTP entrypoint now emits JSON structured logs for request completion/errors, task lifecycle events, command dispatch, Agent poll/events, credential changes, and subscription-source syncs with `requestId`, `taskId`, `commandId`, `agentId`, and W3C `traceparent` context. Production still needs external log aggregation, retention, alerting, and distributed trace export.
- `/api/v1/observability-metrics` now exposes task state totals, task completion latency, rollback counts, command outbox backlog/lease/overdue/dead-letter counts, ACK/result latency, Agent offline/degraded counts, active alert severity counts, audit-chain verification state, denied audit counts, and quota-exceeded audit counts. `/metrics` renders that snapshot as protected Prometheus text gauges for external scraping. Production still needs richer apply-duration histograms by operation/module, quota-enforcement time series, audit write-failure counters, and alert routing.
- Keep the protected `/events/v1/tasks` and `/events/v1/system-alerts` SSE streams for task/audit and active alert state. They now send `cursor` / `Last-Event-ID` resumable snapshots and keep the connection open for same-instance live broadcasts or derived alert fingerprint changes; production still needs full historical task-status event retention, alert lifecycle persistence, and cross-instance fan-out.

## Can Be Documented Before Coding

- Storage schema and migration plan.
- Agent registration, identity, credential rotation, and revocation.
- Outbox delivery semantics and retry policy.
- RBAC matrix by operation, resource type, resource group, and required permission.
- Runtime release protocol for artifact URI, checksum, signature, preflight, snapshot, health verification, and rollback.
- Production SLO and alert thresholds.

## Current Risks

- The frontend still defaults to the mock API for UX stability; use `VITE_CONTROL_PLANE_MODE=http` to point it at the service-backed HTTP control plane.
- The service-backed HTTP adapter is wired to `src/server/control-plane` and supports `memory` or single-process `file` repository storage. File storage preserves task, audit, idempotency, outbox, Agent event, forward rule, and permission grant state across local backend restarts, but it is not a production database.
- The file repository does not provide multi-process locking, HA, migrations, encryption-at-rest, backup/restore policy, retention management, or crash-recovery guarantees beyond temp-file rename writes.
- The HTTP adapter can enforce optional bootstrap bearer tokens for operator mutations, sensitive reads, Agent poll, and Agent events, and protected operator-route authentication failures now write sanitized denied audit evidence. This prevents trusting spoofed `X-Actor`/group headers when auth is configured, but it is not a full identity platform.
- Bootstrap tokens are configured from environment variables and are not yet durable, hashed at rest, rotated, revoked through the panel, rate-limited, or audited as login/token lifecycle events.
- `/agent/v1/poll` and `/agent/v1/events` can authenticate Agent bearer tokens, bind them to `agentId`, and audit authentication failures or identity mismatches without token material. Service-backed poll/event handling now persists Agent events, records heartbeat/session liveness, binds leased commands to the polling `sessionId`, records the safe lease owner/session read-model fields, records `lastSeenCommandSeq`, rejects stale events within the same `agentId + sessionId` sequence window, and rejects deadline-expired ACK/result events while expiring the outbox command, failing the related task, and writing a task failure audit.
- Service-backed Agent enrollment now exchanges the one-time install token through `/agent/v1/register`, persists only credential digests, revokes the install credential after redemption, appends sanitized runtime credential issuance audit evidence, appends sanitized `audit.denied` evidence for failed registration attempts, projects the registered host as `provisioning` with non-sensitive registration metadata, and requires a `purpose: runtime` credential for `/agent/v1/poll` and `/agent/v1/events`.
- Operator-visible Agent credential inventory and revocation now exist through `/api/v1/agent-credentials` and `/api/v1/agent-credentials/{credentialId}/revoke`; public responses omit raw token material and `tokenHash`, and revocation writes an audit-chain event.
- Runtime credentials are now bound to the registration `sessionId`; service-backed `/agent/v1/poll` and `/agent/v1/events` reject token reuse from a different or missing session.
- Production still needs stronger device identity material such as mTLS/JWT key rotation, richer health-probe SLO/alerting policy, HA-safe command timeout sweep coordination, dead-letter retention, and external durable log chunk storage/export controls.
- Service-backed audit hash-chain verification now uses SHA-256, but production tamper resistance still needs append-only storage controls, export retention, and optional external anchoring. Browser mock verification remains test-only.
- Runtime apply tasks now persist config revision, preflight plan, and runtime snapshot read models; Agent results advance those records through applied/failed/verified/restored lifecycle states. Inline artifacts are materialized for host-agent, Xray inbound, and port-forwarding apply paths, Agent apply rejects checksum/signature mismatches before snapshot/preflight, Master rejects applied revision mismatches, and failed health summaries are retained on config revisions. External artifact storage, real cryptographic signing, durable snapshot inventory, GOST/kernel adapters, and health-based rollback policy are still production backlog.
- SSE task events now return protected task-status and audit-summary snapshot events with `cursor` / `Last-Event-ID` resume support, then keep the stream open for live task/audit broadcasts within the same HTTP server instance. SSE system-alert events return protected active-alert snapshots with the same resume pattern and publish a new snapshot when derived alert state changes. Production still needs full historical task-status event retention, alert lifecycle persistence, notification fan-out, and multi-instance fan-out.
- Service-backed external subscription sync now restricts remote fetches to `http` / `https`, blocks localhost and private/local IP literals plus DNS-resolved private/local targets, enforces an optional host egress allowlist before calling the fetcher, applies per-source request timeout and response body limits, and writes allowlist-miss/blocked-target/timeout/oversize/unsupported-protocol outcomes into the sync failure state and audit hash chain. Production still needs DNS rebinding-resistant connection pinning and distributed fetch rate limiting.
