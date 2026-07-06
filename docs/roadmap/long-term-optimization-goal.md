# OU-UI Next Long-Term Optimization Goal

This document is the durable execution contract for the long-running OU-UI Next optimization goal. It exists so goal-mode prompts can stay short while the detailed product, engineering, runtime, QA, and release requirements remain versioned in the repository.

## Current Baseline

The current baseline is `V2.0.0` on `main`.

Known completed V2.0.0 foundation work:

- `package.json` version is `2.0.0`.
- The main README was rewritten and keeps the existing logo at `src/assets/cat-logo.png`.
- Xray runtime artifacts support `metadata.clients[]` and compile them into multi-client inbound settings, `clientPolicies[]`, and per-client share URIs.
- The Agent runtime profile reader expands `clientPolicies[]` so telemetry and guardrail evaluation can run per client.
- Forwarding runtime artifacts declare runtime capabilities and identify controls still blocked by the Agent runtime.
- V2.0.0 verification passed with lint, typecheck, full tests, and build.
- The `V2.0.0` tag has been pushed.

Post-V2.0.0 progress already landed on `main`:

- Forwarding UI now reuses the same supported / blocked runtime control registry as runtime artifacts.
- Forwarding entry selection disables Agents without `port-forwarding` capability instead of silently accepting unsupported hosts.
- Forwarding rules now expose rule-level runtime diagnosis states: `ready`, `waiting`, `degraded`, `blocked`, and `failed`.
- Forwarding diagnosis includes rule and binding status, runtime service evidence, nftables/GOST counter evidence, quota/guardrail suspension, blocked Agent controls, impacted binding count, and next-action hints.
- Forwarding and tunnel runtime artifacts now carry a `control-plane-compiled` runtime diagnosis with planned service names, planned binding status, blocked controls, and next-action hints so task previews and later Agent evidence can align with UI diagnosis.
- Task release evidence now reads forwarding runtime diagnosis from runtime artifacts and surfaces it in release rows, task details, failure drawers, copied task context, and copied failure evidence packages.
- Forwarding create/update and tunnel create/update/redeploy now reject Control Plane submissions before runtime apply when an existing rule or in-flight port-forwarding task already owns an overlapping Agent listen binding.
- Xray customer-node upsert tasks now preserve explicit client `expiresAt` values from the UI / read model into task metadata and runtime `clientPolicies`; renew actions update both `remainingDays` and `expiresAt`.
- Subscription link drawers now support confirmed access credential rotation that regenerates both the token preview and secure public path, rewrites all public output URLs for that identity, and persists the rotated access material through subscription client metadata.
- Subscription source sync now emits structured diagnostics for incompatible protocols, malformed nodes, source-rule filtering, same-source dedupe, cross-source duplicates, and remote fetch failures instead of collapsing every import problem into a generic empty-source warning.
- Xray runtime artifacts now preserve operator intent and guardrail evidence for `runtimeDisabledByPolicy` clients while excluding those clients from active Xray `settings.clients`, so quota/expiry-disabled users are not applied to the runtime but their policy and subscription diagnostics remain visible.
- Xray automatic guardrail enforcement now derives disable / resume tasks per client for multi-client inbounds and emits full `metadata.clients[]` so one customer's quota/expiry state does not cause the shared inbound to skip enforcement or lose peer client policy.
- Xray inbound create/update now validates structured `metadata.clients[]` in the API contract and OpenAPI docs, including duplicate identity/email/subscription-rule rejection for traceable multi-client tasks.
- Customer-node UI create/update, enable/disable, quota, renewal, and reset-policy flows now emit a structured single-client `metadata.clients[]` alongside legacy top-level fields, preserving quota, expiry, guardrail, and `trafficMultiplier` evidence for read models and runtime compilation.
- Xray inbound read-model updates now prefer explicit task-level client policy evidence over stale guardrail state while still preserving telemetry counters, so resume and quota-reset style updates can clear disabled policy state.
- Customer-node create/edit forms now restrict selectable runtime targets to Agents with the `xray` capability, preventing non-Xray hosts from accepting customer-node submissions as if runtime apply were supported.
- Mock and service-backed APIs now reject manual `inbound.*` submissions for known Agents that lack the `xray` capability with `agent_runtime_capability.unsupported`, while allowing automatic guardrail tasks derived from existing inbounds.
- Xray inbound delete artifacts now emit `remove_inbound` with no active runtime clients while preserving disabled policy evidence, so delete tasks cannot look like an upsert in Agent evidence.
- Customer-node delete now queues the bound `subscription.delete` task after `inbound.delete` is accepted, closing the normal UI-created Xray client and public subscription identity lifecycle.
- Public subscription output now emits conversion diagnostic headers for selected, URI-converted, and unconverted node counts so format/rendering issues are visible without parsing the generated body.
- Subscription output API and OpenAPI contracts now accept Shadowrocket and Stash formats for generated output and export profiles, matching the producer registry instead of rejecting formats the renderer can already serve.
- Subscription export profile UI now exposes Shadowrocket and Stash as selectable client/output targets, so operators can submit the formats already supported by the Domain, API contract, OpenAPI spec, and renderer.
- Subscription client rule UI now treats public output formats as first-class selections, including Shadowrocket and Stash, and the link drawer/copy/QR flows render from `outputFormats` instead of legacy export-file `formats`.
- A minimal public subscription portal route now exists at `/portal/{securePath}/{subId}`, sharing the public subscription enabled/expiry/quota checks and showing enabled output links, expiry, usage, and generated-node status.
- Subscription link drawers now expose the customer portal URL with copy/open actions, so the backend portal route is discoverable from the operator workflow.

This baseline is not the end state. It is the first runtime-foundation cut. The remaining goal is to make OU-UI Next a real, production-oriented self-hosted Master / Agent gateway control panel rather than a broad UI shell with partial runtime depth.

## Hard Machine Constraints

The current machine has a strict CPU policy:

- Long-running CPU usage must not stay above 30%.
- Do not run watch mode.
- Do not leave development servers running.
- Do not leave Playwright, Chrome, Vite, Node, or other validation processes running in the background.
- Prefer targeted test subsets during implementation.
- Run full verification only at meaningful milestones.
- Avoid repeated full-suite loops.
- If browser validation is required, use a one-shot check only.
- After any Playwright or browser validation, run:

```bash
pgrep -af '[p]laywright-core|[c]hrome.*playwright_chromiumdev_profile' || true
/usr/local/sbin/zaki-playwright-cleanup
```

If a command risks sustained CPU load, prefer smaller batches, targeted tests, or a pause between stages.

## Operating Rules

Before any change:

- Check `git status --short --branch`.
- Do not overwrite or revert user changes.
- Read the surrounding code before editing.
- Prefer existing project patterns and technology.
- Keep changes scoped to the current milestone.
- Do not replace the logo or brand assets.
- Do not add fake features or UI-only shells.
- Do not document Preview or Roadmap features as implemented.
- Keep the README and feature matrices accurate.

During implementation:

- Make real code changes, not just plans.
- Each important behavior change must have tests or executable verification.
- Prefer domain and runtime correctness over surface UI expansion.
- If a feature cannot be implemented yet, expose that honestly as blocked, Preview, or Roadmap.
- Keep single-client legacy behavior compatible while improving multi-client support.
- Avoid broad refactors unless they directly reduce risk or unlock the current milestone.

After each verifiable stage:

- Run targeted tests first.
- Run milestone verification before commit.
- Commit with a clear message.
- Push to `main` when credentials are available.
- Do not create a new tag unless the user explicitly confirms a release version.

## Long-Term Product Goal

OU-UI Next should become a real self-hosted Master / Agent gateway operations platform with:

- First-class Xray inbound and client management.
- A runtime-backed Agent model that can apply, verify, roll back, and report evidence.
- Forwarding and tunnel management that is operationally useful, not just form-based.
- Subscription and customer-facing delivery that operators can actually sell or run.
- Accurate documentation, safe defaults, and verifiable release quality.

The reference projects are:

- 3X-UI: Xray inbound, client, subscription, traffic, and runtime management depth.
- MiaoMiaoWuX: user, notification, subscription, certificate, proxy group, and operational workflow breadth.
- Flvx: forwarding, tunnel, nftables runtime, diagnosis, and node status depth.

OU-UI Next should learn from those projects without abandoning its own Master / Agent architecture.

## Milestone 1: Xray Inbound / Client First-Class Domain

Goal: stop treating customer nodes and clients as mostly generic task metadata.

Required outcomes:

- Add or strengthen first-class domain models for:
  - Inbound
  - Client
  - TrafficPolicy
  - QuotaPolicy
  - TLS settings
  - Reality settings
  - SubscriptionBinding
- Add explicit APIs or service flows for:
  - inbound create
  - inbound update
  - inbound delete
  - inbound enable / disable
  - client create
  - client update
  - client delete
  - client enable / disable
  - client traffic reset
  - client expiration update
  - client quota update
  - client IP limit update
  - client subscription binding
- Keep compatibility with existing task-based runtime dispatch.
- Reduce dependence on arbitrary metadata keys for core behavior.
- Make validation errors specific and operator-friendly.
- Add tests for single-client and multi-client workflows.

Acceptance criteria:

- A client can be created, updated, disabled, reset, and bound to subscription output through a clear flow.
- Existing single-client customer node tests still pass.
- Multi-client read models, runtime artifacts, and subscription data remain consistent.
- Generic task metadata is still supported as a compatibility layer, not the only model.

## Milestone 2: Xray Runtime Parity

Goal: make Xray runtime behavior genuinely applyable, verifiable, and recoverable.

Required outcomes:

- Strengthen the runtime pipeline:
  - compile
  - diff
  - preflight
  - snapshot
  - apply
  - reload
  - verify
  - rollback
  - runtime evidence
- Keep `xray run -test` preflight and expand evidence reporting.
- Verify generated Reality / TLS / fallback / SNI / gRPC / WS settings.
- Preserve independent client profiles when multiple customers share one runtime inbound.
- Ensure deletion of the final inbound stops and removes the Xray service.
- Avoid claiming Hysteria2, WireGuard, or TUN are production runtime features until actual Agent support exists.
- Add tests around runtime artifact output, Agent profile persistence, and rollback/evidence behavior.

Acceptance criteria:

- A generated Xray artifact carries enough evidence to understand what changed and what the Agent applied.
- Failed preflight cannot be treated as a successful runtime apply.
- Runtime-disabled clients can be excluded without losing their policy or telemetry history.
- Multi-client guardrail behavior is covered by tests.

## Milestone 3: Agent Capability and UI Alignment

Goal: the UI must not present unsupported runtime controls as if they are working.

Required outcomes:

- Create or strengthen an Agent capability registry.
- Make runtime capabilities available to UI and service logic.
- Align UI controls with Agent runtime support.
- For these forwarding controls:
  - `ipRateLimitMbps`
  - `maxConnections`
  - `maxConnectionsPerIp`
  - `proxyProtocol`
- Either implement real runtime support or mark the control blocked/Preview in UI and docs.
- Prevent blocked controls from being silently submitted as successful production behavior.
- Surface blocked controls in task previews, validation messages, and runtime evidence.

Acceptance criteria:

- Operators can see which controls are supported by the selected Agent.
- Unsupported controls are disabled, explained, or clearly marked Preview.
- Runtime artifacts continue to identify blocked controls.
- Tests cover blocked-control UX or API behavior.

## Milestone 4: Forwarding / Tunnel Runtime Depth

Goal: make forwarding and tunnel workflows operationally useful.

Required outcomes:

- Strengthen forwarding runtime:
  - port conflict detection
  - health checks
  - traffic statistics
  - rule-level rate limit
  - IP-level rate limit or explicit blocked state
  - connection limit or explicit blocked state
  - proxy protocol or explicit blocked state
  - batch operations
  - pause / resume / delete state
  - runtime diagnosis
  - nftables state repair
- Strengthen tunnel domain:
  - entry nodes
  - exit nodes
  - chain model
  - quality probes
  - failover state
  - diagnosis output
- Use Flvx as a reference for nftables and runtime diagnosis depth.
- Avoid turning tunnel into a decorative form without actual runtime meaning.

Acceptance criteria:

- Forwarding rules have visible runtime state and actionable failure reasons.
- Port conflicts and missing runtime dependencies are surfaced clearly.
- Telemetry and counters are tied to rule state.
- Tunnel fields either drive runtime behavior or are clearly marked Roadmap.

## Milestone 5: Subscription and Customer Delivery

Goal: make subscription delivery usable for real customers.

Required outcomes:

- Strengthen binding between:
  - Xray client
  - Subscription client identity
  - Secure path
  - Output formats
  - Quota and expiration
- Improve output support:
  - URI
  - v2ray base64
  - Clash
  - Mihomo
  - sing-box
  - Shadowrocket
  - Stash
- Add or improve:
  - QR code
  - copy links
  - token rotation
  - secure path regeneration
  - expiration display
  - traffic usage display
  - subscription-userinfo header
  - request rate limit
- Add import diagnostics:
  - unsupported protocol
  - malformed source
  - duplicate node
  - missing credential
  - missing server or port
  - provider fetch failure
  - private or blocked egress target
- Build at least a minimal customer-facing subscription portal or prepare the backend and routes for it.

Acceptance criteria:

- A customer subscription identity can be traced back to the clients and nodes it exposes.
- Token or secure path rotation does not break unrelated identities.
- Public subscription output is tested and time-stable.
- README accurately distinguishes finished portal work from Roadmap work.

## Milestone 6: Storage and Backend Structure

Goal: move beyond JSON-state as the only production shape without breaking current installs.

Required outcomes:

- Design a migration path from JSON-state SQLite to stronger domain tables.
- Candidate tables:
  - inbounds
  - clients
  - subscription_clients
  - subscription_sources
  - forward_rules
  - tunnels
  - traffic_rollups
  - command_outbox
  - audit_log
  - runtime_revisions
- Preserve backup and restore behavior.
- Keep compatibility with existing V2.0.0 state.
- Add migrations gradually.
- Ensure repository tests cover old-state and new-state compatibility.

Acceptance criteria:

- Existing installations can load and migrate safely.
- New state has clearer query boundaries for core entities.
- Backup, restore, smoke, and audit behavior remain intact.

## Milestone 7: Code Structure and Maintainability

Goal: reduce large-file fragility while preserving behavior.

Required outcomes:

- Split oversized files only when it directly helps the current work:
  - `AppShell`
  - `nodes-page`
  - `subscription-mixer-page`
  - large API/service files
- Move business mutations into feature hooks, controllers, or service helpers.
- Add form adapters where UI forms map to domain/API payloads.
- Keep UI components focused on rendering and interaction.
- Preserve existing tests and add focused tests for extracted logic.

Acceptance criteria:

- Extracted modules have clear ownership and tests.
- No behavior regression from purely structural changes.
- The code becomes easier to change for future runtime work.

## Milestone 8: UI Productization

Goal: make the panel feel like a real operations tool.

Required outcomes:

- Avoid marketing-page patterns and decorative-only sections.
- Make key workflows efficient:
  - create inbound
  - add client
  - rotate subscription
  - inspect runtime state
  - apply forwarding rule
  - diagnose failed Agent task
- Show real status, evidence, and failure reasons.
- Improve high-risk confirmations.
- Make Preview and blocked controls visually clear.
- Keep text accurate and compact.
- Ensure mobile and desktop layouts do not overlap or hide critical content.

Acceptance criteria:

- Operators can understand what is running, what failed, and what action to take.
- Blocked controls cannot be mistaken for implemented controls.
- UI changes are covered by tests where practical.

## Milestone 9: Security and Operations

Goal: keep production-facing safety boundaries intact while adding features.

Required outcomes:

- Preserve or strengthen:
  - operator sessions
  - CSRF protection
  - Agent install token separation
  - Agent runtime credential rotation
  - command/task/agent event matching
  - subscription source egress protection
  - webhook egress protection
  - audit-chain evidence
  - log and smoke secret redaction
- Never print:
  - passwords
  - bearer tokens
  - install tokens
  - runtime credentials
  - cookies
  - CSRF values
  - raw subscription secrets
- Keep doctor, smoke, backup, restore, archive, and acceptance flows working.
- Fix security issues before polish work when discovered.

Acceptance criteria:

- Feature work does not weaken secret handling or egress controls.
- Security-sensitive tests continue to pass.
- README and docs do not instruct unsafe defaults.

## Milestone 10: Documentation and Release Discipline

Goal: keep the project honest and releasable.

Required outcomes:

- README remains accurate after every milestone.
- Feature matrices distinguish:
  - Implemented
  - Preview
  - Blocked by Agent runtime
  - Roadmap
- Roadmap is updated when major work lands.
- Release notes should mention real changes, not aspirational features.
- Do not create a tag unless the user explicitly confirms a version.
- For a future release candidate, propose a version and summary first.

Acceptance criteria:

- Documentation matches the code.
- Unimplemented features are not marketed as implemented.
- Every release candidate has verification results.

## Verification Strategy

Use staged verification to respect CPU limits.

During a focused change:

```bash
npm test -- <relevant test files>
npm run typecheck
```

Before a milestone commit:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

If full verification fails:

- Separate code failures from environment failures.
- Fix code failures before commit.
- If a missing system dependency is needed and can be installed, install it.
- If an environment issue cannot be fixed, document the exact command, failure, and impact.

Known test stability rule:

- Tests depending on project fixture dates should use a fixed test clock, not the machine's real date.

## Commit and Push Rules

- Commit after each meaningful, verified milestone.
- Use concise commit messages that describe the actual shipped change.
- Push to `main` when credentials are available.
- Do not amend or rewrite published history unless the user explicitly asks.
- Do not create release tags without explicit user approval.
- Keep the worktree clean after each completed stage.

## Final Completion Definition

The long-term goal is complete only when all core criteria below are true:

- Xray inbound and client management have first-class domain/API workflows.
- Multi-client support works across UI, API, read models, runtime artifacts, Agent profile, telemetry, guardrails, and subscription output.
- UI controls match Agent runtime capabilities.
- Forwarding and tunnel workflows are operationally useful and have diagnosis paths.
- Subscription and customer delivery are suitable for real use.
- Storage and backend structure are stronger than the current JSON-state-only model or have a safe migration path underway.
- Large code paths have been reduced enough to support future changes safely.
- README and roadmap accurately describe implemented, Preview, blocked, and Roadmap features.
- Security boundaries remain intact.
- Important changes are tested.
- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` pass at the final milestone.
- All stage commits have been pushed.
- The final report lists completed work, remaining non-core items, verification results, commit hashes, and the recommended next release version.
