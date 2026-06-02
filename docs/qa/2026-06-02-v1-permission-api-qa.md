# OU-UI Next v1 Permission/API QA

## Scope

This QA pass validates the V1.0 follow-up slice: permission matrix, UI idempotency, versioned API boundary, task state machine, audit before/after records, API-backed forwarding/subscription/routing/tuning data, and backend/Agent contract documentation.

## Commands

- `npm.cmd test` - passed, 3 files / 18 tests.
- `npm.cmd run typecheck` - passed.
- `npm.cmd run lint` - passed.
- `npm.cmd run build` - passed.

## Rendered QA

Target URL: `http://127.0.0.1:4174/`

Browser path: Browser plugin controls were not exposed in this tool session. The bundled Playwright package was incomplete (`playwright-core` missing), so rendered validation used Microsoft Edge headless via Chrome DevTools Protocol.

Flow under test:

`production preview -> admin/admin login -> 分组授权 -> 提交权限变更 -> 执行记录 -> permission.grant change visible`

Observed:

- Page title is `OU-UI Next`.
- The page is nonblank and renders `.bg-env`, `.island-panel`, and `.btn-glow`.
- Permission submission creates exactly one `提交隧道分组权限变更` task, even with repeated UI submission coverage in tests.
- Task row shows `permission.grant` and `queued`.
- Desktop viewport `1280x720` renders the task queue without login overlay or framework error overlay.
- Mobile viewport `390x844` renders the permission matrix with no horizontal overflow.
- Edge CDP console capture reported no warnings or errors.

Screenshots:

- Desktop: `C:/Users/Administrator/AppData/Local/Temp/ou-ui-next-cdp-desktop-1780350934434.png`
- Mobile: `C:/Users/Administrator/AppData/Local/Temp/ou-ui-next-cdp-mobile-1780350934434.png`

## Regression Coverage

- `App.test.tsx` covers login, visual shell, forwarding task creation, deploy preflight drawer, permission task creation, repeated permission submit dedupe, task refresh without runtime task creation, and dark-mode toggle.
- `mock-api.test.ts` covers typed inventories, subscription bundles, rate limit policies, task/audit creation, V1 API boundary, mutation request context, idempotency, state-machine transitions, audit before/after, and `module.install` resource classification.
- `visual-constitution.test.tsx` covers the required visual constitution class tokens.

## Production Boundary

- `docs/architecture/backend-agent-contract.md` defines backend/Universal Agent module boundaries, versioned API paths, command channel, runtime lifecycle, permission/quota/audit closure, and production acceptance criteria.
- The current runtime is still a typed mock adapter. Real V1.0 backend work remains for persistent auth/RBAC, Agent command delivery, config compilation, quota enforcement, and append-only audit storage.
