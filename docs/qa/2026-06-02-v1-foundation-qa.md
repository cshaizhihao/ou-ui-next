# OU-UI Next v1 Foundation QA

## Scope

This QA pass validates the first v1.0 foundation slice: React/Vite engineering, visual constitution migration, mock control-plane data, task/audit loop, drawer/modal overlay, theme toggle, SVG flow, and responsive shell.

## Commands

- `npm.cmd test` - passed, 3 files / 11 tests.
- `npm.cmd run typecheck` - passed.
- `npm.cmd run lint` - passed with 0 warnings.
- `npm.cmd run build` - passed.
- `npm.cmd audit --omit=dev` - passed, 0 production vulnerabilities.

## Browser QA

Target URL: `http://127.0.0.1:4173/`

Browser path: Codex in-app Browser.

Flow under test:

`app loads -> development login -> 端口转发 -> 应用端口转发策略 -> 执行记录 -> queued change visible`

Observed:

- Page title is `OU-UI Next`.
- Login overlay renders logo, glass inputs, and `btn-glow` submit.
- Authenticated shell renders OU-UI Next sidebar, topbar, page outlet, and dark glass surfaces.
- Forwarding action creates `应用端口转发策略` task with `queued` status.
- Topbar deploy action opens `.overlay.open`, `.drawer-panel.open`, and `.modal-panel`.
- Theme control toggles `html.dark`.
- Dashboard renders `.svg-flow-stop-1`, `.svg-flow-stop-2`, and `.svg-line-dash`.
- Desktop viewport `1280x720`: shell uses row layout, sidebar `240px`, main work area around `980px`.
- Mobile viewport `390x844`: shell uses column layout, sidebar and main are both around `366px`; no squeezed two-column control plane.
- Browser console reported no warnings or errors.

Screenshots:

- Desktop: `C:/Users/Administrator/AppData/Local/Temp/ou-ui-next-desktop-final.png`
- Mobile: `C:/Users/Administrator/AppData/Local/Temp/ou-ui-next-mobile-final.png`

## Visual Constitution Checkpoints

- Glass panels preserve `island-panel`, `island-card`, backdrop blur, physical borders, and dark-mode translucency.
- Core controls preserve `btn-glow`, `glass-input`, `glass-toggle`, and `logo-cat`.
- Ambient environment preserves `bg-env`, `ambient-orb`, `orb-1`, `orb-2`, and `bg-grid`.
- Page transitions preserve `page-view active`, `stagger-1`, and `stagger-2`.
- Drawer/modal behavior now has actual React DOM, not CSS-only placeholders.

## Backend Boundary

The current slice is a typed mock-control-plane implementation. The UI must not be interpreted as a live Agent runtime yet.

Backend-required capabilities:

- Agent install, upgrade, rollback, SSH bootstrap, and command channel.
- Xray/GOST/port-forwarding config compile, apply, hot reload, and port binding confirmation.
- External subscription fetch, traffic header accounting, and request rate enforcement.
- Quota enforcement, rate limiting, billing settlement, and over-quota shutdown.
- RBAC enforcement and append-only audit persistence.

The frontend exposes these as typed domains and task/audit contracts so a Go backend and Universal Agent can replace the mock adapter without rewriting the UI.
