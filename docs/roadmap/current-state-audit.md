# OU-UI Next Current State Audit

Round: 0 - current-state audit and construction baseline  
Date: 2026-07-07  
Branch: `main`  
Baseline commit: `b18e818`  
Scope: repository, README, long-term roadmap, production deployment on `4174`, current Control Plane snapshot, browser UI, and historical real-Agent runtime evidence.

## Executive Summary

OU-UI Next is no longer only a static prototype. The repository already contains a meaningful V2.0.0 runtime foundation: HTTP Control Plane, authenticated sessions, Agent command/event channel, Xray runtime artifacts, runtime evidence, subscription output, forwarding capability boundaries, SQLite persistence, and browser-visible workspaces.

The project is still not at the target product quality. The biggest gaps are:

- Deployment reliability is fragile. At the start of this audit, nothing was listening on `4174` or `4010`, and the earlier ad-hoc pid files were stale. The app had to be restored with transient systemd services.
- UI quality and operation flow are far behind the runtime ambition. The nodes workspace can show real runtime evidence, but it exposes too many controls and too much row-level noise at once.
- The visual system is not suitable for a production operations console. The current palette and tests still encode fauvist/glass/glow assumptions.
- The Agent/runtime proof chain exists, but current state includes dead-letter command evidence and historical Xray smoke failures after earlier passes.
- Forwarding and subscription workspaces have real backend/domain pieces, but the current deployed data set has no forwarding rules or subscription identities, so those workflows are not yet proven end to end in the live panel.

Round 0 intentionally makes no functional code change. Its output is this construction map and a restored `4174` deployment for review.

## Evidence Sources

- `git status --short --branch`: clean `main...origin/main` before this document.
- `package.json`: version `2.0.0`; scripts include `build`, `typecheck`, `lint`, `test`, `smoke:browser`, `smoke:production`, `smoke:xray-apply`, and `smoke:xray-client-action`.
- `docs/roadmap/long-term-optimization-goal.md`: durable long-term execution contract and post-V2.0.0 baseline.
- `README.md`: current V2.0.0 feature matrix and implemented / Preview / Roadmap split.
- `ui-ux-pro-max` skill:
  - Recommended product direction: dense operations dashboard.
  - Critical checks: accessibility, touch/interaction, loading feedback, responsive layout, semantic color tokens, predictable navigation, accessible data display.
- Public browser validation:
  - `http://172.93.187.112:4174/` root returned 200.
  - Login with `admin/admin` returned 201.
  - Authenticated `/api/v1/snapshot` returned 200.
  - Browser reached the authenticated dashboard and node workspace.
- Current snapshot:
  - Agents: 1.
  - Inbounds: 35.
  - Tasks: 144.
  - Command outbox: 144.
  - Config revisions: 139.
  - Preflight plans: 139.
  - Runtime snapshots: 139.
  - System alerts: 1.
  - Forwarding rules: 0.
  - Subscription identities/sources/inventory nodes: 0.

## Current Verified Capabilities

### Version and Documentation

- `package.json` is already `2.0.0`.
- README keeps the existing logo path and describes V2.0.0 as a runtime-foundation release.
- README correctly marks Hysteria/WireGuard/TUN, advanced forwarding controls, full customer portal work, and strong normalized database work as Preview/Roadmap instead of production-complete.
- Long-term roadmap captures the remaining milestones and explicitly forbids fake UI-only success.

### Control Plane and Deployment

- The production build artifacts exist in `dist` and `dist-server`.
- Restored production runtime during this audit:
  - `ou-ui-next-backend-4174.service`: transient systemd unit running `node dist-server/http-control-plane-main.js`.
  - `ou-ui-next-static-4174.service`: transient systemd unit serving `dist` on `0.0.0.0:4174` and proxying API/Agent/public subscription routes to `127.0.0.1:4010`.
- Local and public checks after restoration:
  - Local root/login/snapshot: `200 / 201 / 200`.
  - Public root/login/snapshot: `200 / 201 / 200`.
- Same-origin HTTP login works in the current build.

### Agent and Runtime Evidence

- Current live snapshot reports one online Agent:
  - ID: `agent-fb073c1d5053`.
  - Capabilities: `host-agent`, `xray`, `port-forwarding`, `self-update`.
  - Runtime version: `1.0.0-runtime`.
- Runtime evidence model is present:
  - Command outbox entries.
  - Config revisions.
  - Preflight plans.
  - Runtime snapshots.
  - Task release evidence.
  - Runtime diagnosis stages such as `control-plane-compiled` and `agent-result-verified`.
- Current evidence counts:
  - Config revisions: 131 applied, 8 failed.
  - Preflight plans: 131 passed, 8 failed.
  - Runtime snapshots: 131 verified, 8 captured.
  - Command outbox: 133 completed, 9 dead-letter, 2 expired.
- Historical real-Agent Xray smoke evidence exists:
  - `diagnostics/local-deploy/xray-smoke-latest.json` shows a passed Xray apply smoke on 2026-07-07 around 01:09Z.
  - Later smoke files show failures such as `command.result.timeout`, `read ECONNRESET`, and missing Agent result evidence.

### Xray / Client Management

- The repository has real Xray runtime artifact support:
  - `metadata.clients[]`.
  - `clientPolicies[]`.
  - per-client share URI generation.
  - policy-disabled clients excluded from active Xray `settings.clients`.
  - quota/expiry guardrail evidence preserved for disabled clients.
- API/domain code includes explicit Xray client action support:
  - `xray-client-actions`.
  - `applyXrayClientAction`.
  - client enable/disable, add/delete, quota, renewal, reset, policy update, IP-limit paths.
- Current node workspace renders 35 customer nodes from the snapshot.
- The node page shows runtime evidence labels including Agent verification, command count, config revision ID, failed/applying states, and task evidence.

### Forwarding / Tunnel

- Domain and task builder code contains a shared blocked-control model for:
  - `ipRateLimitMbps`
  - `maxConnections`
  - `maxConnectionsPerIp`
  - `proxyProtocol`
- README and runtime artifact code do not claim those controls are production-complete.
- Current live data set has 0 forwarding rules, so live forwarding operation value is not proven in this audit.

### Subscription

- README and code describe public output formats including URI/v2ray, Clash/Mihomo, sing-box, Shadowrocket, and Stash.
- Public subscription output and minimal portal routes exist in the product surface.
- Current live data set has 0 subscription identities, 0 subscription sources, and 0 inventory nodes, so customer subscription delivery is not proven with current deployed data.

### Accessibility and Interaction Positives

- The codebase has many explicit accessibility and interaction primitives:
  - focus traps for drawers/palettes.
  - visible focus styles.
  - `aria-label`, `role="dialog"`, `role="status"`, and loading skeleton coverage.
  - tests for focus restoration and keyboard behavior.
- This is a real foundation, but it is inconsistent with the current visual and information architecture quality.

## UI/UX Audit with ui-ux-pro-max

`ui-ux-pro-max` recommends this product behave as a dense, high-trust operations dashboard:

- compact dashboards and tables over marketing surfaces.
- semantic runtime states over decorative color.
- 150-300ms purposeful feedback over decorative motion.
- visible loading, error, and recovery paths.
- strong keyboard/focus behavior.
- stable information hierarchy for operators under pressure.

Current UI deviates in several ways.

### Visual System Problems

- Source scan found more than 1600 raw hex color matches in UI files.
- Source scan found more than 140 gradient-related matches.
- 27 files still reference glass/backdrop/glow patterns.
- Tests still encode `fauvist`, `glass`, `glow`, and hard-coded palette expectations.
- Current first-screen background is a pale yellow/cream surface, while the controls use saturated blue/red/yellow/green accents. This creates a loud visual language that does not match a serious operations console.
- The project uses many direct Tailwind arbitrary colors instead of semantic tokens such as `runtime-verified`, `runtime-waiting`, `runtime-failed`, `policy-disabled`, `preview`, `blocked`, and `quota-risk`.

### Information Architecture Problems

- The app has major destinations: overview, servers, nodes, forwarding, subscription, governance/evidence.
- The top-level navigation exists and is reachable, but workflow intent is still spread across too many panels and row-end controls.
- Browser sampling showed the node workspace with 35 rows and 442 buttons. That is too much direct action surface for a primary operations screen.
- The dashboard overview says `0 nodes` while the node workspace shows 35 customer nodes. This is likely a metric-definition issue, but it is confusing and should be resolved or labeled.
- A browser automation sample did not successfully transition from subscription to governance/evidence by exact nav label, so Round 1/3 should verify navigation targets and accessible names more rigorously.

### Interaction Problems

- Nodes can show evidence, but common workflows still require hunting through many row actions, drawers, and evidence surfaces.
- Runtime evidence exists but is not always summarized as "what happened, what is trusted, what should I do next" in one stable operator strip.
- Failed states often expose low-level evidence, but recovery affordances need a stronger, consistent pattern.
- Empty forwarding/subscription pages are visually present but do not yet teach the operator the next verified action path.
- Initial unauthenticated session check logs a browser console 401. This is normal behavior, but it appears as an error in browser diagnostics and should be made less noisy if possible.

### Accessibility and Layout Risks

- There is real focus-management work, but the current visual density makes keyboard navigation expensive.
- Small pills, dense buttons, and raw color usage increase contrast and target-size risk.
- Mobile should be revalidated once the visual system is rebuilt; current screen-level text and button volume will be hard to scan on narrow viewports.

## Runtime Trust Audit

### Trusted

- The Control Plane can authenticate, load the snapshot, and render the dashboard.
- The live Agent is online and advertises required capabilities.
- Most historical runtime evidence is successful: 131 verified/applied/passed evidence chains.
- Node rows can display `agent-result-verified` style evidence.

### Not Trusted Enough Yet

- There is an active critical alert: `Command outbox dead letter`.
- There are 9 dead-letter and 2 expired command outbox entries.
- There are 8 failed config/preflight/runtime-snapshot chains.
- Historical post-pass smoke runs include `command.result.timeout` and backend proxy `ECONNRESET`.
- The current audit did not run a new mutating Xray apply smoke. It only verified live Agent presence/capabilities and current evidence readout. A new mutating smoke should be done in a dedicated runtime round after deployment reliability is hardened.

## UI-only / Weak / Preview Areas

The following should not be marketed as production-complete until proven in live runtime flows:

- Hysteria2, WireGuard, and TUN runtime inbound apply.
- Forwarding advanced controls:
  - `ipRateLimitMbps`
  - `maxConnections`
  - `maxConnectionsPerIp`
  - `proxyProtocol`
- Full production customer portal lifecycle beyond the current minimal portal.
- Subscription source import/sync with live providers in the deployed data set.
- Forwarding/tunnel operation with live rules, counters, health, and recovery in the deployed data set.
- Strong normalized production schema beyond the current SQLite JSON-state plus entity-index bridge.
- Persistent production deployment unit files for the local `4174` review app.

## Code Structure Audit

Largest files sampled:

- `src/features/nodes/nodes-page.tsx`: about 9970 lines.
- `src/features/subscriptions/subscription-mixer-page.tsx`: about 6646 lines.
- `src/components/layout/app-shell.tsx`: about 3569 lines.
- `src/features/forwarding/forwarding-page.tsx`: about 3028 lines.
- `src/services/api/control-plane-api.ts`: about 1887 lines.

This is a maintainability risk. The project should not start with a broad refactor, but each future round should extract the business mutations, evidence selectors, drawer composers, and read-model mappers touched by that round.

## P0 / P1 / P2 Priorities

### P0

1. Deployment reliability and white-screen prevention.
   - Make `4174` root/login/snapshot/browser smoke permanent.
   - Replace ad-hoc pid files with reliable service management.
   - Prevent root page blank/cream-screen regressions.
   - Add same-origin API/base-path checks.

2. UI visual system rebuild.
   - Replace fauvist/glass/glow hard-coded palette with operations-console tokens.
   - Define semantic state colors for runtime evidence and policy states.
   - Update tests away from hard-coded fauvist class expectations.

3. Information architecture and navigation.
   - Make overview, servers, nodes, forwarding, subscriptions, and evidence destinations unambiguous.
   - Add or strengthen a status center for Agent state, failed tasks, runtime apply state, and quota risk.
   - Reduce node page action overload.

4. Xray node cockpit.
   - Keep the existing runtime evidence strength, but turn it into a clearer operator workflow:
     - inspect.
     - act.
     - see accepted task.
     - see command/preflight/snapshot/Agent result.
     - recover or rollback.

5. Runtime apply evidence hardening.
   - Resolve dead-letter state.
   - Re-run mutating Xray smoke in a controlled round.
   - Make failed/timeout/ACK-silent states recoverable from one focused surface.

### P1

- Multi-client operator workflow hardening beyond the current drawer.
- Subscription identity/source/output delivery with real live data.
- Forwarding/tunnel rules with health checks, counters, conflicts, blocked controls, and recovery paths.
- Traffic/quota/expiry consistency across Xray, forwarding, subscriptions, and customer views.
- Security and audit polish for high-risk actions.

### P2

- Full database normalization.
- More complete customer portal.
- Advanced protocol families after Agent runtime support exists.
- Release-candidate hardening and documentation refresh.

## Round Baseline

| Round | Focus | Current Status |
| --- | --- | --- |
| 0 | Current-state audit | Completed by this document |
| 1 | `4174` and production deploy reliability | P0 next |
| 2 | UI visual system rebuild | P0 next after deploy smoke |
| 3 | Information architecture and navigation | P0 |
| 4 | Xray customer-node cockpit | P0 |
| 5 | Multi-client shared inbound | P1; foundation exists, workflow needs hardening |
| 6 | Real Agent Xray apply/evidence loop | P0/P1; must resolve current dead-letter risk |
| 7 | Agent install/upgrade/recovery/capability parity | P1 |
| 8 | Subscription and customer portal | P1 |
| 9 | Subscription import/sync/diagnostics | P1 |
| 10 | Forwarding/tunnel operations | P1 |
| 11 | Traffic/quota/expiry/billing model | P1 |
| 12 | Permissions/security/audit | P1 |
| 13 | README/docs/deploy | P2 after product truth changes |
| 14 | Release candidate hardening | P2 |

## Next Round Acceptance Criteria

Round 1 should be considered successful only if:

- `4174` and `4010` are started by a repeatable command or service, not stale pid files.
- Local and public root/login/snapshot checks pass.
- A browser smoke verifies login and the first authenticated screen.
- Playwright/Chrome is cleaned after validation.
- The app does not show a blank cream page when unauthenticated or after login.
- Snapshot latency and backend CPU behavior are measured and documented.
- Any service management change is committed, pushed, and deployed.

## Audit Limits

- This round did not run a new mutating Xray apply smoke because it would alter the live runtime state during an audit-only pass.
- This round did not refactor UI or backend code.
- This round restored the review deployment using transient systemd units. That is acceptable for review continuity, but not sufficient as the final deployment mechanism.
