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
| One-click Master install and management CLI | `src/server/control-plane/install-master-script.test.ts`, README install/doctor/credential/smoke/acceptance sections, installer-generated nginx/session/doctor/smoke/acceptance coverage, `scripts/production-smoke.cjs`, `scripts/production-browser-smoke.cjs`, `scripts/production-notification-smoke.cjs` | Implemented with automated script-contract coverage, reusable live HTTP/browser/notification smoke entrypoints, installed `ou sm` / `ou bs` / `ou ns` shortcuts, `ou qa` evidence-bundle command, `ou qv` bundle integrity verification, and an optional `--require-runtime-evidence` gate for real Agent/Xray/forwarding field evidence; still needs a fresh live install transcript for final acceptance. |
| Chinese-first operator UI | `src/app/App.test.tsx`, `src/components/layout/app-shell.test.tsx`, feature page tests, README UI scope | Covered by UI/component tests and production terminology checks. |
| Real Agent enrollment and runtime loop | `src/server/control-plane/agent-install-script.test.ts`, `src/server/control-plane/control-plane-service.test.ts`, `src/services/api/agent-telemetry-read-model.test.ts`, README Agent runtime sections | Covered by script and API/read-model tests plus installed `ou-agent doctor` diagnostics, `ou-agent qa` evidence-bundle with sanitized `runtime-summary.json`, and `ou-agent qv` bundle verification commands; final acceptance still needs a real host Agent run against a deployed Master. |
| Agent command and task convergence | `src/server/control-plane/control-plane-service.test.ts`, `src/services/api/service-backed-control-plane-api.test.ts`, `src/services/api/api-contract.test.ts` | Covered for ACK/result binding, stale replay, terminal-state protection, rollback, command timeout, and task audit behavior. |
| Xray customer-node management | `src/domain/runtime-artifacts.test.ts`, `src/services/api/xray-telemetry-read-model.test.ts`, `src/services/api/subscription-output.test.ts`, `src/services/api/service-backed-control-plane-api.test.ts` | Covered for artifact generation, telemetry counters, runtime guardrails, protocol-specific subscription output, and quota recovery behavior. |
| Port forwarding management | `src/features/forwarding/forwarding-page.test.tsx`, `src/services/api/forwarding-telemetry-read-model.test.ts`, `src/server/control-plane/control-plane-service.test.ts`, README forwarding sections | Covered for task creation, Agent-result proof, conflict projection, pause/resume, quota guardrails, rate-limit direction, and billing windows. |
| Subscription orchestration | `src/features/subscriptions/subscription-mixer-page.test.tsx`, `src/domain/subscription.test.ts`, `src/services/api/subscription-output.test.ts`, `src/services/api/service-backed-control-plane-api.test.ts` | Covered for external source sync guardrails, provider budgets, duplicate warnings, provider traffic headers, generated subscriptions, public download quota guardrails, and read-model persistence. |
| Quota and reset workflows | `src/services/api/quota-policies.test.ts`, `src/services/api/quota-reset-tasks.test.ts`, `src/services/api/service-backed-control-plane-api.test.ts`, metrics tests | Covered for managed-host, customer-node, subscription-user, forwarding, reset baselines, exceeded/disabled states, and system-alert projection. |
| Audit chain and denied evidence | `src/server/control-plane/operator-session-store.test.ts`, `src/server/control-plane/file-control-plane-repository.test.ts`, `src/services/api/http-control-plane-client.test.ts`, `src/services/api/service-backed-control-plane-api.test.ts` | Covered for session audit, denied audit, chain verification, duplicate audit rejection, exported verification, and external audit anchors. |
| System alerts and notifications | `src/services/api/system-alerts.test.ts`, `src/services/api/system-alert-notifications.test.ts`, `src/services/api/prometheus-metrics.test.ts`, Telegram tests in `src/services/api/service-backed-control-plane-api.test.ts`, `src/server/control-plane/production-notification-smoke-script.test.ts` | Covered for active/resolved lifecycle, SSE-visible alert kinds, webhook retry/dead-letter, Telegram traffic/expiry/subscription/provider/report/system-alert delivery queues, egress hardening, metrics, and the sanitized real Telegram test-notification smoke helper. |
| Observability and Prometheus | `src/services/api/prometheus-metrics.test.ts`, `src/services/api/api-contract.test.ts`, README metrics sections | Covered for task, runtime, command, Agent, alert, webhook, Telegram, quota, audit, log, and traffic-rollup metrics. |
| OpenAPI, HTTP, browser, and notification acceptance contract | `src/services/api/openapi-contract.test.ts`, `src/services/api/http-control-plane-server.test.ts`, `src/services/api/http-control-plane-auth.test.ts`, `src/services/api/http-control-plane-client.test.ts`, `src/server/control-plane/production-smoke-script.test.ts`, `src/server/control-plane/production-browser-smoke-script.test.ts`, `src/server/control-plane/production-notification-smoke-script.test.ts` | Covered for protected APIs, CSRF/session behavior, public Telegram webhook exception, Agent route boundaries, schema drift checks, production smoke URL/credential helper behavior, browser smoke report/credential helper behavior, and notification smoke target/report redaction behavior. |
| GitHub/README sync discipline | README updates, README.en updates, and this QA document in the same iteration as acceptance tooling changes | Current branch is kept synced to `origin/main` after each completed iteration. |

## Reusable Production Smoke, Browser, And Notification Acceptance Entry

The repository now includes `scripts/production-smoke.cjs`, exposed as `npm run smoke:production` and wired into the installed management CLI as `ou-ui smoke` / `ou sm`, for live HTTP deployment evidence collection. It also includes `scripts/production-browser-smoke.cjs`, exposed as `npm run smoke:browser` and wired into the installed management CLI as `ou-ui browser-smoke` / `ou bs`, for real browser workflow evidence collection. The browser smoke uses Playwright to drive the installed panel URL through login, key page navigation, screenshot capture, and logout without printing passwords, cookies, CSRF tokens, or bearer tokens. `scripts/production-notification-smoke.cjs`, exposed as `npm run smoke:notifications` and `ou-ui notification-smoke` / `ou ns`, logs in through the installed panel, reads Telegram settings, calls the protected Telegram test-notification API, and writes a sanitized report without printing passwords, cookies, CSRF tokens, bot tokens, chat IDs, or binding IDs.

The installed CLI also exposes `ou-ui acceptance` / `ou qa`, which writes a timestamped evidence bundle under `/var/lib/ou-ui-next/acceptance/` containing doctor output, HTTP smoke terminal output, browser smoke terminal output, notification-smoke skipped/executed evidence, sanitized JSON reports, a `browser-screenshots.tar.gz` archive, and a manifest with per-file byte sizes and SHA-256 hashes for later archive verification. `ou d` / the bundle `doctor.txt` now reports browser-smoke readiness too: presence of `scripts/production-browser-smoke.cjs`, Playwright module availability, and whether the Chromium executable exists. The same CLI exposes `ou-ui acceptance-verify` / `ou qv` to re-check those hashes after archiving or transferring the bundle; the verifier remains backward-compatible with older bundles that only contain the original doctor/smoke/report files or pre-notification browser evidence. To keep the bundle self-consistent, `ou qa` fixes the installed panel URL, root-only credentials file, bundle-local report paths, screenshot directory, and notification report path, while still allowing read-only smoke tuning flags such as `--timeout-ms`, `--insecure-tls`, `--skip-csrf-probe`, and `--require-runtime-evidence`; low-resource hosts can explicitly use `--skip-browser-smoke`, which records the skip in the manifest rather than pretending browser acceptance ran. Notification smoke is skipped by default to avoid sending Telegram messages during every acceptance run; operators can opt in with `--include-notification-smoke --telegram-admin-chat-id <id>` or `--include-notification-smoke --telegram-binding-id <id>`, with `--notification-language` mapped to the notification script's `--language` flag.

The HTTP smoke report records a sanitized runtime acceptance summary with counts for Agents, Agent sessions, Xray inbounds, port-forwarding rules/ports, quota states, task states, traffic rollups, system-alert severities/kinds, command dead letters, and audit health. It intentionally does not include Agent IDs, session IDs, forwarding IDs, tokens, cookies, CSRF values, or passwords. When `ou sm --require-runtime-evidence` or `ou qa --require-runtime-evidence` is used, the run fails unless the deployed Master shows at least one online/degraded Agent session, at least one Xray inbound, at least one port-forwarding rule/port, no critical system alerts, and no command dead letters; the failure reasons are preserved in `smoke-report.json`.

On each enrolled host, `ou-agent qa` now adds `runtime-summary.json` to the Agent evidence bundle. The summary records runtime file presence/size/SHA-256, module runtime states, Xray inbound counts, port-forwarding service counts, guardrail counts, and pending-event counts, while intentionally omitting raw artifacts, client UUIDs/emails, forwarding target addresses, and Agent tokens. `ou-agent qv` verifies this new file when present and remains compatible with earlier Agent bundles that only contain doctor, service status, and redacted log-tail evidence.

The HTTP smoke target can use either the installed nginx secure-path URL or a direct backend URL and validates:

- public `/api/v1/boundary`
- anonymous rejection for protected `/api/v1/snapshot`
- `POST /api/v1/auth/session` login with returned HttpOnly cookie and CSRF token
- protected `/api/v1/snapshot`, `/api/v1/observability-metrics`, and `/metrics`
- sanitized runtime acceptance summary in `smoke-report.json`, optionally hardened by `--require-runtime-evidence`
- bounded `/events/v1/tasks?once=1` and `/events/v1/system-alerts?once=1` SSE responses
- optional missing-CSRF stateless POST probe expecting `403 csrf.required`
- `DELETE /api/v1/auth/session` logout

The script reads the installer credentials file at `/etc/ou-ui-next/credentials.env` by default, supports explicit `OU_UI_SMOKE_USERNAME` / `OU_UI_SMOKE_PASSWORD`, and does not print passwords, cookies, CSRF tokens, or backend bearer tokens. The installed CLI shortcut automatically injects the current panel URL and credentials-file path. `--report` / `OU_UI_SMOKE_REPORT_PATH` writes a sanitized JSON report with `0600` permissions for live acceptance archives. The default CSRF probe intentionally leaves sanitized `audit.denied` evidence and can be disabled with `OU_UI_SMOKE_CSRF_PROBE=0`, `sudo ou sm --skip-csrf-probe`, or `npm run smoke:production -- --skip-csrf-probe`.

The browser smoke target validates:

- real login page rendering
- operator login through the browser form
- navigation to `主机探针`, `端口转发`, `订阅管理`, `安全策略`, `系统调优`, `执行记录`, and `审计日志`
- screenshot capture after each passed browser step when `--screenshot-dir` is set
- browser logout and return to the login page

The script reads the installer credentials file at `/etc/ou-ui-next/credentials.env` by default, supports explicit `OU_UI_BROWSER_SMOKE_USERNAME` / `OU_UI_BROWSER_SMOKE_PASSWORD`, and writes sanitized reports with `0600` permissions. It fails clearly when Playwright or browser binaries/system dependencies are unavailable; that failure is intentional acceptance evidence rather than a mocked pass.

The notification smoke target validates:

- operator login through the installed panel URL
- Telegram settings API reachability and whether the bot token is configured
- one explicit Telegram target, either an admin chat ID or a customer binding ID
- protected `POST /api/v1/integrations/telegram-bot/test` with CSRF and idempotency headers
- delivered test-notification status in the returned delivery record
- sanitized report output with only target kind and redacted delivery metadata
- operator logout

The script reads the installer credentials file at `/etc/ou-ui-next/credentials.env` by default, supports explicit `OU_UI_NOTIFICATION_SMOKE_USERNAME` / `OU_UI_NOTIFICATION_SMOKE_PASSWORD`, and writes sanitized reports with `0600` permissions. It fails when no target is provided, more than one target is provided, Telegram settings cannot be read, the test API is rejected, or the returned delivery is not `delivered`; those failures are preserved in `notification-smoke-report.json` when a report path is configured.

## Local Verification Gate

Completed after the production smoke entry was introduced:

- `node --check scripts/production-smoke.cjs`
- `node --check scripts/production-browser-smoke.cjs`
- `node --check scripts/production-notification-smoke.cjs`
- `node scripts/production-smoke.cjs --help`
- `node scripts/production-browser-smoke.cjs --help`
- `node scripts/production-notification-smoke.cjs --help`
- `bash -n scripts/install-master.sh`
- `npm run test -- production-notification-smoke-script production-browser-smoke-script production-smoke-script install-master-script agent-install-script` - 5 files / 75 tests
- `npm run lint`
- `npm run test` - 60 files / 709 tests
- `npm run build`
- `git diff --check`
- `git diff --cached --check`

## Not Yet Proven By This Audit

These are evidence gaps, not necessarily missing code:

- Fresh one-click install from GitHub on a clean server, including install output, doctor output, `ou sm` output, `ou qa` evidence bundle, `ou qv` bundle verification, nginx secure path, SSE, Prometheus, and uninstall cleanup.
- Domain deployment verification for `ouui.zze.cc` without disturbing unrelated nginx applications.
- Real Agent installation on an actual host followed by heartbeat, telemetry, command apply, log chunk upload, credential rotation against the deployed Master, and a Master-side `ou qa --require-runtime-evidence` bundle that proves the Agent/Xray/forwarding read models are present without critical alerts or command dead letters.
- Agent-side `ou-agent doctor` output, `ou-agent qa` evidence bundle, and `ou-agent qv` verification output from that host, showing service state, runtime files, pending queue, event seq, Xray/GOST binary availability, guardrail state, sanitized `runtime-summary.json`, redacted log tail, and SHA-256 manifest without printing runtime tokens.
- Real Xray and port-forwarding runtime apply on a host with systemd, including post-apply health proof and rollback proof.
- Browser smoke test output from a deployed panel. The repository now has reusable `ou bs` / `npm run smoke:browser` tooling and `ou qa` bundles browser evidence by default, but this audit still lacks a real deployment run with Playwright/browser dependencies installed on the target host.
- External notification smoke output from operator-provided Telegram/webhook endpoints with real credentials. The repository now has reusable `ou ns` / `npm run smoke:notifications` tooling and optional `ou qa --include-notification-smoke` bundle capture, but this audit still lacks a real provider run proving delivery outside automated tests.

## Current Residual Product Gaps

- Telegram V1 still has follow-up work for richer interactive multi-binding command sessions, `/unbind`, and in-chat binding create/revoke workflows.
- A final production acceptance run should attach command output or QA notes for each live deployment step above before marking V1 complete.

## Acceptance Stance

Current repository evidence strongly supports the production implementation across the requested core modules, but final completion remains unproven until the live deployment and real-Agent smoke tests are executed and recorded.
