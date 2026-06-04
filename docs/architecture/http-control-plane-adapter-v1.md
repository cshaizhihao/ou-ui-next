# OU-UI Next HTTP Control Plane Adapter V1

Last updated: 2026-06-02

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

By default it uses in-memory storage. To keep mutation state across local backend restarts, enable file storage:

```powershell
$env:OU_UI_CONTROL_PLANE_STORAGE='file'
$env:OU_UI_CONTROL_PLANE_STATE_FILE='D:\ou-ui-control-plane\control-plane-state.json'
npm.cmd run dev:control-plane
```

Storage modes:

- `OU_UI_CONTROL_PLANE_STORAGE=memory` or unset: keeps task, audit, idempotency, outbox, Agent event, and permission mutation state only for the process lifetime.
- `OU_UI_CONTROL_PLANE_STORAGE=file`: persists the current control-plane repository state into `OU_UI_CONTROL_PLANE_STATE_FILE` by writing a temporary JSON file and renaming it into place after a successful transaction.

Optional bootstrap bearer-token auth can be enabled for local production-hardening runs:

```powershell
$env:OU_UI_CONTROL_PLANE_OPERATOR_TOKEN='replace-with-operator-token'
$env:OU_UI_CONTROL_PLANE_OPERATOR_ACTOR='admin'
$env:OU_UI_CONTROL_PLANE_OPERATOR_GROUP_ID='owner'
$env:OU_UI_CONTROL_PLANE_RESOURCE_GROUP_ID='group-premium'
$env:OU_UI_CONTROL_PLANE_AGENT_TOKENS_JSON='{"agent-hkg-01":"replace-with-agent-token"}'
npm.cmd run dev:control-plane
```

When operator auth is configured, protected control-plane reads and all operator mutations require `Authorization: Bearer <operator-token>`. The adapter derives `actor`, `operatorGroupId`, and `resourceGroupId` from the token identity instead of trusting spoofable `X-Actor` and group headers. `GET /api/v1/boundary` remains open for version discovery.

When Agent auth is configured, `/agent/v1/poll` and `/agent/v1/events` require `Authorization: Bearer <agent-token>` and the token-bound `agentId` must match the request body and every submitted event.

Service-backed Agent enrollment uses `POST /agent/v1/register` to exchange the short-lived install token for a persisted runtime Agent credential. The install credential is revoked after redemption, and service-backed poll/event routes accept `purpose: runtime` credentials only.

Operators can inspect sanitized credential records with `GET /api/v1/agent-credentials` and revoke a credential with `POST /api/v1/agent-credentials/{credentialId}/revoke`. These API responses expose `tokenPrefix` for identification but never expose raw token material or `tokenHash`.

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
- Service-backed Agent registration exchanges one-time install credentials for runtime credentials, stores only token digests, and revokes the install credential after successful redemption.
- Agent credential list/revoke APIs expose only sanitized credential summaries; revocation writes `agent.credential.revoked` into the audit hash chain and makes the credential unusable for subsequent Agent authentication.
- Runtime Agent credentials are bound to the registration session and reject mismatched or missing session identities on service-backed poll/event requests.
- Agent poll accepts `sessionId` and `lastSeenCommandSeq`, leases commands with the polling session bound into the `AgentCommandEnvelope`, and records an Agent session liveness read model in the service-backed repository.
- Agent event intake persists events, deduplicates by `eventId`, records heartbeat/session liveness, and rejects stale events inside the same `agentId + sessionId` monotonic sequence window.
- Service-backed Agent read models derive `online`, `degraded`, and `offline` status from the most recent heartbeat or telemetry signal using the configured 30-second probe cadence.
- The published Agent runtime script executes `health` and `telemetry` commands explicitly and reports unsupported command types as failed results.
- Idempotency conflicts write `audit.denied`.
- Stale `If-Match` on supported resources writes `audit.denied`.
- Permission overreach for `permission.grant` writes `audit.denied`.
- Agent ACK moves a queued task to running.
- Agent result moves a running task to succeeded or failed.
- Command outbox entries can be created by task mutations or explicit `issueAgentCommand`.
- Agent polling leases eligible commands, marks them `dispatched`, increments `attempts`, records `leasedAt`/`leaseExpiresAt`, suppresses duplicate in-flight polls, and retries after lease expiry until the command deadline expires.
- Deadline-expired commands are marked `expired`, linked queued/running/retrying tasks are failed with `command.deadline.expired`, and a task failure audit is appended.
- Agent ACK/result events observed at or after command deadline are rejected with `agent_event.command_deadline_expired`; the stale event does not advance the task to succeeded.
- Runtime command compilation now differentiates `apply`, `reload`, and `rollback` Agent command envelopes. Apply commands reference persistent config revision, preflight plan, and runtime snapshot records that are queryable through the HTTP API.
- Agent result events now advance runtime release read models in the same repository transaction as task/outbox/audit updates: successful apply marks config revisions `applied`, preflight plans `passed`, and snapshots `verified`; failed apply marks config/preflight records `failed`; successful rollback marks the referenced snapshot `restored`.
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
- `control-plane-service.ts` also persists Agent install/runtime credentials as token digests, redeems install tokens through `registerAgent`, lists sanitized credential summaries, revokes credentials with audit, and resolves only active runtime credentials for service-backed Agent poll/event authentication.
- `GET /api/v1/config-revisions`, `GET /api/v1/preflight-plans`, and `GET /api/v1/runtime-snapshots` expose the release read models for operator diagnostics and future release dashboards.
- `control-plane-service.ts` also enforces a first-pass operation permission matrix (`operate`, `configure`, `grant`) before task creation, and persists authorized `permission.grant` changes into the repository.
- `control-plane-service.test.ts` covers task/audit/idempotency/outbox atomicity, Agent event state progression, RBAC denial/allow paths, and permission grant persistence.
- `src/services/api/service-backed-control-plane-api.ts` adapts the service kernel into the existing `ControlPlaneApi` interface, so `createHttpControlPlaneServer()` can run against the service path instead of the mock adapter.
- `src/services/api/http-control-plane-auth.test.ts` covers optional operator and Agent bearer-token gates, sensitive-read protection, token-bound Agent identity, and token boundary separation.
- `src/services/api/http-control-plane-client.ts` can attach separate operator and Agent bearer tokens so the frontend can talk to an auth-enabled local backend in HTTP mode.
- `src/services/api/http-control-plane-service-api.test.ts` proves the HTTP server can create service-backed tasks, surface service-backed audit/outbox state, enforce RBAC denial, persist permission grants, and let Agent ACK/result events advance task state.
- `src/server/control-plane/create-service-backed-control-plane.test.ts` proves the service-backed HTTP factory starts with seeded inventory and empty task/audit state, and that file storage restores mutation state across backend restarts.

The Vite frontend still defaults to the mock API for local UX stability. The next backend step is to replace the file repository with a production database and derive mutation context from real authenticated identity instead of trusted test headers.

## Dependency Security Note

`npm audit --omit=dev` currently reports zero production dependency vulnerabilities. Full `npm audit` reports Vite/Vitest/esbuild development-server advisories that require a breaking Vite upgrade according to npm. Production deployments must not expose the Vite dev server; the dev-toolchain upgrade remains a tracked follow-up.

## Not Yet Production Backend

This adapter is not a production backend by itself. It wraps a service-backed `ControlPlaneApi` implementation with selectable `memory` or `file` repository storage and optional bootstrap bearer-token gates. It is suitable for frontend integration, contract testing, local durable demos, and early backend shape validation.

The file repository is still a single-node development persistence layer, not a production database. It assumes one backend process owns the state file, does not provide multi-replica locking, migrations, encryption-at-rest, backup/restore policy, retention management, or high availability. The service-backed audit hash chain uses SHA-256, but tamper resistance still depends on append-only storage controls and retention/export policy.

The bearer-token layer is a hardening slice, not the final identity platform. Production V1 still needs password/session or OIDC/JWT operator identity, Agent credential rotation issuance, rate limiting, and audit-visible login/token lifecycle events.

Production V1 still needs code for:

- Production database storage for tasks, audit logs, idempotency records, command outbox, agent events, permission grants, config revisions, preflight plans, runtime snapshots, and telemetry samples.
- Full authentication for operators and agents beyond the current bootstrap bearer-token registry.
- Agent identity registration, credential rotation, and poll/event authentication.
- Database-grade transactional task/audit/idempotency/outbox writes, including schema migrations, lock semantics, and retention policies.
- Full outbox dispatcher operations beyond the current lease/retry/session/deadline slice: ACK timeout, result timeout, dead-letter handling, lease owner recovery, and command deduplication across transports.
- Agent credential rotation issuance, richer health-probe SLO/alert policy, and log chunk storage.
- Real cryptographic audit hashing/signing and export verification.
- Runtime preflight execution, apply, verify, commit, and rollback.
- Runtime artifact materialization, real cryptographic signing, live snapshot capture, health verification, commit tracking, and automatic rollback policy.
- Quota aggregation, enforcement tasks, and traffic counter gap detection.
- Structured logs, metrics, traces, and production alerting.

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
