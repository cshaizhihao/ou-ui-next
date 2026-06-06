# OU-UI Next V1 Production Acceptance Evidence Audit

Date: 2026-06-06

Audited head: `c982fc1`

This is an evidence audit for the production V1 objective. It is not a final completion claim. It records which parts are currently backed by source, tests, and documentation, and which parts still need a live end-to-end deployment run before the project can be called fully accepted.

## Audit Scope

Target objective:

- One-click installable Chinese control panel.
- Real Agent driven runtime control, not mock-only state transitions.
- Manage Xray, port forwarding, subscriptions, quotas, audit, alerts, and operator notifications.
- Keep README and GitHub remote updated after each production iteration.

Primary acceptance matrix:

- [docs/architecture/v1-production-acceptance.md](../architecture/v1-production-acceptance.md)

## Evidence Summary

| Area | Current evidence | Audit status |
| --- | --- | --- |
| One-click Master install and management CLI | `src/server/control-plane/install-master-script.test.ts`, README install/doctor/credential sections, installer-generated nginx/session/doctor coverage | Implemented with automated script-contract coverage; still needs a fresh live install transcript for final acceptance. |
| Chinese-first operator UI | `src/app/App.test.tsx`, `src/components/layout/app-shell.test.tsx`, feature page tests, README UI scope | Covered by UI/component tests and production terminology checks. |
| Real Agent enrollment and runtime loop | `src/server/control-plane/agent-install-script.test.ts`, `src/server/control-plane/control-plane-service.test.ts`, `src/services/api/agent-telemetry-read-model.test.ts`, README Agent runtime sections | Covered by script and API/read-model tests; final acceptance still needs a real host Agent run against a deployed Master. |
| Agent command and task convergence | `src/server/control-plane/control-plane-service.test.ts`, `src/services/api/service-backed-control-plane-api.test.ts`, `src/services/api/api-contract.test.ts` | Covered for ACK/result binding, stale replay, terminal-state protection, rollback, command timeout, and task audit behavior. |
| Xray customer-node management | `src/domain/runtime-artifacts.test.ts`, `src/services/api/xray-telemetry-read-model.test.ts`, `src/services/api/subscription-output.test.ts`, `src/services/api/service-backed-control-plane-api.test.ts` | Covered for artifact generation, telemetry counters, runtime guardrails, protocol-specific subscription output, and quota recovery behavior. |
| Port forwarding management | `src/features/forwarding/forwarding-page.test.tsx`, `src/services/api/forwarding-telemetry-read-model.test.ts`, `src/server/control-plane/control-plane-service.test.ts`, README forwarding sections | Covered for task creation, Agent-result proof, conflict projection, pause/resume, quota guardrails, rate-limit direction, and billing windows. |
| Subscription orchestration | `src/features/subscriptions/subscription-mixer-page.test.tsx`, `src/domain/subscription.test.ts`, `src/services/api/subscription-output.test.ts`, `src/services/api/service-backed-control-plane-api.test.ts` | Covered for external source sync guardrails, provider budgets, duplicate warnings, provider traffic headers, generated subscriptions, public download quota guardrails, and read-model persistence. |
| Quota and reset workflows | `src/services/api/quota-policies.test.ts`, `src/services/api/quota-reset-tasks.test.ts`, `src/services/api/service-backed-control-plane-api.test.ts`, metrics tests | Covered for managed-host, customer-node, subscription-user, forwarding, reset baselines, exceeded/disabled states, and system-alert projection. |
| Audit chain and denied evidence | `src/server/control-plane/operator-session-store.test.ts`, `src/server/control-plane/file-control-plane-repository.test.ts`, `src/services/api/http-control-plane-client.test.ts`, `src/services/api/service-backed-control-plane-api.test.ts` | Covered for session audit, denied audit, chain verification, duplicate audit rejection, exported verification, and external audit anchors. |
| System alerts and notifications | `src/services/api/system-alerts.test.ts`, `src/services/api/system-alert-notifications.test.ts`, `src/services/api/prometheus-metrics.test.ts`, Telegram tests in `src/services/api/service-backed-control-plane-api.test.ts` | Covered for active/resolved lifecycle, SSE-visible alert kinds, webhook retry/dead-letter, Telegram traffic/expiry/subscription/provider/report/system-alert delivery queues, egress hardening, and metrics. |
| Observability and Prometheus | `src/services/api/prometheus-metrics.test.ts`, `src/services/api/api-contract.test.ts`, README metrics sections | Covered for task, runtime, command, Agent, alert, webhook, Telegram, quota, audit, log, and traffic-rollup metrics. |
| OpenAPI and HTTP contract | `src/services/api/openapi-contract.test.ts`, `src/services/api/http-control-plane-server.test.ts`, `src/services/api/http-control-plane-auth.test.ts`, `src/services/api/http-control-plane-client.test.ts` | Covered for protected APIs, CSRF/session behavior, public Telegram webhook exception, Agent route boundaries, and schema drift checks. |
| GitHub/README sync discipline | Current pushed commits through `c982fc1`, README updates in the same commits | Current branch is kept synced to `origin/main` after each completed iteration. |

## Local Verification Gate

Completed after this audit document was added:

- `npm run lint`
- `npm run test` - 57 files / 683 tests
- `npm run build`
- `git diff --check`

## Not Yet Proven By This Audit

These are evidence gaps, not necessarily missing code:

- Fresh one-click install from GitHub on a clean server, including install output, doctor output, session login, nginx secure path, SSE, Prometheus, and uninstall cleanup.
- Domain deployment verification for `ouui.zze.cc` without disturbing unrelated nginx applications.
- Real Agent installation on an actual host followed by heartbeat, telemetry, command apply, log chunk upload, and credential rotation against the deployed Master.
- Real Xray and port-forwarding runtime apply on a host with systemd, including post-apply health proof and rollback proof.
- Browser smoke test against the deployed panel covering login, managed-host registration visibility, customer node, forwarding, subscription, quota reset, audit, alerts, and Telegram settings.
- External notification smoke tests against operator-provided Telegram/webhook endpoints with real credentials, while confirming no secrets appear in logs, API responses, or delivery history.

## Current Residual Product Gaps

- Telegram V1 still has follow-up work for richer interactive multi-binding command sessions, `/unbind`, and in-chat binding create/revoke workflows.
- A final production acceptance run should attach command output or QA notes for each live deployment step above before marking V1 complete.

## Acceptance Stance

Current repository evidence strongly supports the production implementation across the requested core modules, but final completion remains unproven until the live deployment and real-Agent smoke tests are executed and recorded.
