# OU-UI Next V1 Production Acceptance Evidence Audit

Date: 2026-06-06

Audited baseline: `fdf2d12`

This is an evidence audit for the production V1 objective. It is not a final completion claim. It records which parts are currently backed by source, tests, reusable smoke tooling, and documentation, and which parts still need a live end-to-end deployment run before the project can be called fully accepted.

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
| One-click Master install and management CLI | `src/server/control-plane/install-master-script.test.ts`, README install/doctor/credential/smoke sections, installer-generated nginx/session/doctor/smoke coverage, `scripts/production-smoke.cjs` | Implemented with automated script-contract coverage, a reusable live smoke entrypoint, and an installed `ou sm` shortcut; still needs a fresh live install transcript for final acceptance. |
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
| OpenAPI and HTTP contract | `src/services/api/openapi-contract.test.ts`, `src/services/api/http-control-plane-server.test.ts`, `src/services/api/http-control-plane-auth.test.ts`, `src/services/api/http-control-plane-client.test.ts`, `src/server/control-plane/production-smoke-script.test.ts` | Covered for protected APIs, CSRF/session behavior, public Telegram webhook exception, Agent route boundaries, schema drift checks, and production smoke URL/credential helper behavior. |
| GitHub/README sync discipline | Current pushed commits through `b5b1471` before this CLI-smoke shortcut iteration, README updates in the same iteration | Current branch is kept synced to `origin/main` after each completed iteration. |

## Reusable Production Smoke Entry

The repository now includes `scripts/production-smoke.cjs`, exposed as `npm run smoke:production` and wired into the installed management CLI as `ou-ui smoke` / `ou sm`, for live deployment evidence collection. It targets either the installed nginx secure-path URL or a direct backend URL and validates:

- public `/api/v1/boundary`
- anonymous rejection for protected `/api/v1/snapshot`
- `POST /api/v1/auth/session` login with returned HttpOnly cookie and CSRF token
- protected `/api/v1/snapshot`, `/api/v1/observability-metrics`, and `/metrics`
- bounded `/events/v1/tasks?once=1` and `/events/v1/system-alerts?once=1` SSE responses
- optional missing-CSRF stateless POST probe expecting `403 csrf.required`
- `DELETE /api/v1/auth/session` logout

The script reads the installer credentials file at `/etc/ou-ui-next/credentials.env` by default, supports explicit `OU_UI_SMOKE_USERNAME` / `OU_UI_SMOKE_PASSWORD`, and does not print passwords, cookies, CSRF tokens, or backend bearer tokens. The installed CLI shortcut automatically injects the current panel URL and credentials-file path. The default CSRF probe intentionally leaves sanitized `audit.denied` evidence and can be disabled with `OU_UI_SMOKE_CSRF_PROBE=0`, `sudo ou sm --skip-csrf-probe`, or `npm run smoke:production -- --skip-csrf-probe`.

## Local Verification Gate

Completed after the production smoke entry was introduced:

- `node --check scripts/production-smoke.cjs`
- `node scripts/production-smoke.cjs --help`
- `bash -n scripts/install-master.sh`
- `npm run test -- install-master-script` - 1 file / 37 tests
- `npm run test -- production-smoke-script` - 1 file / 4 tests
- `npm run lint`
- `npm run test` - 58 files / 688 tests
- `npm run build`
- `git diff --check`
- `git diff --cached --check`

## Not Yet Proven By This Audit

These are evidence gaps, not necessarily missing code:

- Fresh one-click install from GitHub on a clean server, including install output, doctor output, `ou sm` output, nginx secure path, SSE, Prometheus, and uninstall cleanup.
- Domain deployment verification for `ouui.zze.cc` without disturbing unrelated nginx applications.
- Real Agent installation on an actual host followed by heartbeat, telemetry, command apply, log chunk upload, and credential rotation against the deployed Master.
- Real Xray and port-forwarding runtime apply on a host with systemd, including post-apply health proof and rollback proof.
- Browser smoke test against the deployed panel covering login, managed-host registration visibility, customer node, forwarding, subscription, quota reset, audit, alerts, and Telegram settings. The CLI smoke script covers the lower-level HTTP/session/SSE/metrics surface, but it does not replace browser workflow evidence.
- External notification smoke tests against operator-provided Telegram/webhook endpoints with real credentials, while confirming no secrets appear in logs, API responses, or delivery history.

## Current Residual Product Gaps

- Telegram V1 still has follow-up work for richer interactive multi-binding command sessions, `/unbind`, and in-chat binding create/revoke workflows.
- A final production acceptance run should attach command output or QA notes for each live deployment step above before marking V1 complete.

## Acceptance Stance

Current repository evidence strongly supports the production implementation across the requested core modules, but final completion remains unproven until the live deployment and real-Agent smoke tests are executed and recorded.
