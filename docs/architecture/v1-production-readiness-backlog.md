# OU-UI Next V1 Production Readiness Backlog

Last updated: 2026-06-04

This backlog separates the current frontend + mock-backed HTTP adapter from the remaining production V1 backend work.

## Must Add Code

Persistence:

- Replace the current tested in-memory/file repositories in `src/server/control-plane` with a production database store for `DeployTask`, `AuditLog`, idempotency records, `CommandOutboxItem`, Agent events, permission grants, config revisions, preflight plans, runtime snapshots, and telemetry samples.
- Preserve the current service contract: task creation, audit write, idempotency record, and command outbox insert must stay in one transaction.
- Add migrations, lock semantics, backup/restore procedures, and retention policies.

Task outbox:

- Build on the current HTTP-pull lease/retry slice with ACK timeout, result timeout, dead-letter states, lease owner/session tracking, and transport-specific dispatchers.
- Keep at-least-once delivery semantics and require Agent-side idempotency by `commandId` and `configRevision`.

Agent runtime:

- Authenticate `/agent/v1/poll` and `/agent/v1/events`.
- Keep the service-level `eventId` idempotency and the service-backed `agentId + sessionId + seq` monotonic replay guard now covered by `src/server/control-plane/control-plane-service.test.ts`.
- Bind `sessionId` into HTTP-pulled command envelopes and persist poll-side `lastSeenCommandSeq` as Agent session progress.
- Store heartbeat, telemetry samples, result events, log chunks, and Agent session liveness read models. Service-backed host lists now derive `online` / `degraded` / `offline` from heartbeat or telemetry age. Log chunks are retrievable through the protected `/api/v1/agent-log-chunks` read API, and service-backed writes now prune retained log chunks by age and per-Agent cap. Production still needs external durable log storage, export, and operator-visible retention controls.
- The published Agent runtime script now executes `health` and `telemetry` commands explicitly, emits `telemetry_sample` from explicit telemetry requests, and returns failed results for unsupported command types instead of acknowledged no-ops.
- Keep the service-level tests that reject Agent ACK/result events observed after command deadline, expire the command outbox entry, fail the related queued/running/retrying task, and write a task failure audit.
- Continue hardening Agent health probes with richer module-specific checks, SLO thresholds, and alert routing.
- Continue hardening durable Agent registration with explicit rotation APIs and stronger Agent identity material.

Audit ledger:

- Keep service-backed audit-chain hashing on real SHA-256. The browser mock adapter remains non-cryptographic and should not be treated as tamper resistance.
- Make audit append-only.
- Add export verification and optional external anchoring.
- Ensure rejected auth/RBAC/idempotency/resource-version/quota requests write `audit.denied`.

RBAC:

- Replace the current bootstrap bearer-token registry with real session/OIDC/JWT operator identity and durable Agent credential records.
- Continue deriving actor, operator group, resource group, and agent identity from authenticated credentials, not from trusted client headers.
- Keep the service-level operation-to-permission matrix now covered in `src/server/control-plane/control-plane-service.test.ts`, then expand it with resource-type-specific checks and high-risk confirmation policy.
- Add `permission.revoke` guardrails so the last administrative path cannot be removed accidentally.

Runtime release:

- Build on the current semantic Agent command compiler, repository-backed config revision / preflight plan / runtime snapshot read models, and Agent-result-driven release lifecycle updates.
- Implement real compile -> diff -> preflight -> snapshot -> apply -> verify -> commit.
- Implement durable rollback tasks, runtime snapshot inventory, artifact storage, and health-based rollback policy.
- Add module adapters for Xray, GOST, port forwarding, and kernel tuning with allowlisted operations.

Quota:

- Aggregate ingress/egress counters from Agent telemetry.
- Detect sampling gaps.
- Enforce user, tunnel, tunnel-account, and forward-rule quotas.
- Create system actor tasks for automatic quota enforcement.

Observability:

- Add structured logs with `requestId`, `taskId`, `commandId`, `agentId`, and trace context.
- Add metrics for command backlog, ACK latency, result latency, apply duration, rollback count, Agent offline, audit write failure, and quota exceeded.
- Keep the protected `/events/v1/tasks` SSE snapshot stream for task status and audit summaries, then extend it with live pub/sub delivery across HTTP server instances.

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
- The HTTP adapter can enforce optional bootstrap bearer tokens for operator mutations, sensitive reads, Agent poll, and Agent events. This prevents trusting spoofed `X-Actor`/group headers when auth is configured, but it is not a full identity platform.
- Bootstrap tokens are configured from environment variables and are not yet durable, hashed at rest, rotated, revoked through the panel, rate-limited, or audited as login/token lifecycle events.
- `/agent/v1/poll` and `/agent/v1/events` can authenticate Agent bearer tokens and bind them to `agentId`. Service-backed poll/event handling now persists Agent events, records heartbeat/session liveness, binds leased commands to the polling `sessionId`, records `lastSeenCommandSeq`, rejects stale events within the same `agentId + sessionId` sequence window, and rejects deadline-expired ACK/result events while expiring the outbox command, failing the related task, and writing a task failure audit.
- Service-backed Agent enrollment now exchanges the one-time install token through `/agent/v1/register`, persists only credential digests, revokes the install credential after redemption, and requires a `purpose: runtime` credential for `/agent/v1/poll` and `/agent/v1/events`.
- Operator-visible Agent credential inventory and revocation now exist through `/api/v1/agent-credentials` and `/api/v1/agent-credentials/{credentialId}/revoke`; public responses omit raw token material and `tokenHash`, and revocation writes an audit-chain event.
- Runtime credentials are now bound to the registration `sessionId`; service-backed `/agent/v1/poll` and `/agent/v1/events` reject token reuse from a different or missing session.
- Production still needs stronger device identity material such as mTLS/JWT key rotation, richer health-probe SLO/alerting policy, ACK/result timeout sweep jobs, dead-letter retention, and external durable log chunk storage/export controls.
- Service-backed audit hash-chain verification now uses SHA-256, but production tamper resistance still needs append-only storage controls, export retention, and optional external anchoring. Browser mock verification remains test-only.
- Runtime apply tasks now persist config revision, preflight plan, and runtime snapshot read models; Agent results advance those records through applied/failed/verified/restored lifecycle states. The artifact/checksum/signature/snapshot contents are still synthetic; no real Xray/GOST/port-forwarding/kernel artifact is materialized or applied yet.
- SSE task events now return protected task-status and audit-summary snapshot events from the HTTP server. Production still needs long-lived live broadcast, replay cursors, and multi-instance fan-out.
