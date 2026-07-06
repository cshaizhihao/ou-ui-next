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
- The `/api/v1/boundary` descriptor now exposes Agent capability vocabulary, Xray runtime supported protocols, and Forwarding supported/blocked runtime controls, giving external clients the same capability boundary used by the UI and artifact compiler.
- Task release evidence now reads forwarding runtime diagnosis from runtime artifacts and surfaces it in release rows, task details, failure drawers, copied task context, and copied failure evidence packages.
- Forwarding create/update and tunnel create/update/redeploy now reject Control Plane submissions before runtime apply when an existing rule or in-flight port-forwarding task already owns an overlapping Agent listen binding.
- Forwarding create/update/apply/pause/resume/delete mutations now flow through feature-level task input builders; unsupported controls are normalized out of executable metadata and preserved as `blockedRuntimeControls` diagnostics so API contract validation, task evidence, and Agent runtime boundaries stay aligned.
- Forwarding upsert task builders now also normalize blocked controls when called with raw create/update metadata, so bulk migration and rule update flows cannot submit unsupported `ipRateLimitMbps`, `maxConnections`, `maxConnectionsPerIp`, or `proxyProtocol` values as executable Agent settings.
- Forwarding persisted-rule hydration, automatic quota guardrail tasks, read models, and UI diagnosis now reuse the same blocked-control normalizer, preventing direct `forward.apply` / `forward.pause` / `forward.resume` paths from reintroducing unsupported Agent controls while preserving the original requested values as diagnostics.
- Forwarding automatic quota guardrail derivation, quota policy projections, and runtime diagnosis now use billed forwarding bytes to detect rule overage even when `quotaExceeded` is omitted, and generated pause/resume metadata carries the same billed usage evidence shown by rule/account/tunnel quota rows.
- Create-task validation now preserves field-level Zod messages in thrown errors and HTTP 422 details, so direct API submissions of blocked forwarding controls return the specific unsupported runtime-control reason instead of only a generic metadata path.
- Agent command deadline, ACK timeout, and result timeout paths now fail the related runtime config revision and preflight plan instead of leaving release evidence stuck at `compiled` / `pending`; mock mode mirrors the same task and release-evidence failure behavior.
- Xray customer-node upsert tasks now preserve explicit client `expiresAt` values from the UI / read model into task metadata and runtime `clientPolicies`; renew actions update both `remainingDays` and `expiresAt`.
- Xray inbound read models now also preserve explicit per-client `expiresAt` timestamps from task metadata, keeping UI read models aligned with runtime artifact client policies instead of recalculating expiry only from `remainingDays`.
- Subscription client read models now preserve explicit `expiresAt` task metadata as well, so subscription portal/output expiry and Xray client expiry can remain aligned when operators submit absolute expiration timestamps.
- Active Xray Reality create/update submissions now require SNI plus Reality public/private key material at the API contract and runtime-artifact boundaries, while disabled/delete flows can still remove runtime state without requiring stale key material.
- Subscription link drawers now support confirmed public path / token-preview rotation that regenerates the token preview and secure public path, rewrites all public output URLs for that identity, and persists those preview/path fields through subscription client metadata; it is not a raw-token issuance flow for `accessTokenHash`.
- Subscription source sync now emits structured diagnostics for incompatible protocols, malformed nodes, source-rule filtering, same-source dedupe, cross-source duplicates, and remote fetch failures instead of collapsing every import problem into a generic empty-source warning.
- Xray runtime artifacts now preserve operator intent and guardrail evidence for `runtimeDisabledByPolicy` clients while excluding those clients from active Xray `settings.clients`, so quota/expiry-disabled users are not applied to the runtime but their policy and subscription diagnostics remain visible.
- Xray runtime artifact and API-contract active-client checks now also treat `quotaExceeded` and `clientExpired` evidence as policy-disabled runtime state, so expired or over-quota clients cannot remain in active Xray `settings.clients` merely because `runtimeDisabledByPolicy` was omitted.
- Customer-node quota policy projections now surface expired Xray clients as runtime-disabled guardrail state even when traffic usage is below quota, preventing the security workspace from showing an expired client as active.
- Xray automatic guardrail task derivation now treats `quotaExceeded` and `clientExpired` as runtime-disable triggers even when a read model omitted `runtimeDisabledByPolicy`, and generated multi-client disable metadata writes the derived guardrail reason back to the affected client.
- Xray inbound task read models now derive disabled client state from `quotaExceeded` and `clientExpired` evidence as well, so UI/read models do not show a client as enabled when runtime artifacts and guardrail automation would exclude it.
- Subscription client read models and user quota policy projections now derive runtime-disabled guardrail state from quota usage and preserve non-quota runtime-disabled reasons, keeping subscription UI, security quota policy rows, and public subscription diagnostics aligned.
- Xray automatic guardrail enforcement now derives disable / resume tasks per client for multi-client inbounds and emits full `metadata.clients[]` so one customer's quota/expiry state does not cause the shared inbound to skip enforcement or lose peer client policy.
- Xray inbound create/update now validates structured `metadata.clients[]` in the API contract and OpenAPI docs, including duplicate identity/email/subscription-rule rejection for traceable multi-client tasks.
- Customer-node UI create/update, enable/disable, quota, renewal, and reset-policy flows now emit a structured single-client `metadata.clients[]` alongside legacy top-level fields, preserving quota, expiry, guardrail, and `trafficMultiplier` evidence for read models and runtime compilation.
- Xray inbound read-model updates now prefer explicit task-level client policy evidence over stale guardrail state while still preserving telemetry counters, so resume and quota-reset style updates can clear disabled policy state.
- Xray inbound read-model updates now treat a one-client update against an existing multi-client inbound as a single-client patch unless `xrayReplaceClients` / `replaceClients` is explicitly set, so quick enable/disable or quota edits do not drop peer clients or mark a shared inbound disabled while peers remain active.
- Global quick-action enable/disable for shared Xray inbounds now submits the full peer `metadata.clients[]` list and keeps top-level inbound `enabled` true while any peer remains active, preventing Agent runtime artifacts from turning a one-client disable into `remove_inbound`.
- Customer-node create/edit forms now restrict selectable runtime targets to Agents with the `xray` capability, preventing non-Xray hosts from accepting customer-node submissions as if runtime apply were supported.
- Customer-node create/edit forms now include pre-submit Xray runtime readiness diagnostics for Agent capability/status, runtime protocol boundary, same-Agent listener ownership, same-protocol shared inbound reuse, and expected command/preflight/snapshot/Agent-result evidence; hard listener conflicts are blocked before save instead of surfacing as fake success later.
- Mock and service-backed APIs now reject manual `inbound.*` submissions for known Agents that lack the `xray` capability with `agent_runtime_capability.unsupported`, while allowing automatic guardrail tasks derived from existing inbounds.
- Customer-node runtime protocol handling now uses the shared `XRAY_RUNTIME_PROTOCOLS` boundary across UI, global quick actions, API schemas, read models, guardrail task derivation, and runtime artifacts; unsupported protocols such as Hysteria2/WireGuard/TUN remain subscription/Preview concepts and are not rendered as editable/applyable Xray runtime inbound actions.
- Xray inbound create/update now rejects manual submissions before enqueue when the same Agent listener is already reserved by another runtime protocol, while still allowing same-port same-protocol fragments to merge into a multi-client inbound.
- Xray inbound delete artifacts now emit `remove_inbound` with no active runtime clients while preserving disabled policy evidence, so delete tasks cannot look like an upsert in Agent evidence.
- Customer-node delete now queues the bound `subscription.delete` task after `inbound.delete` is accepted, closing the normal UI-created Xray client and public subscription identity lifecycle.
- Customer-node inbound create/update/delete mutations now flow through feature-level task input builders instead of `AppShell` hand-assembling inbound task inputs, preserving API-contract validation, delete risk confirmation, and idempotency keys that change when non-secret runtime fields such as enabled state, quotas, expiry, transport, and guardrail evidence change.
- Customer-node single-row and bulk client actions now flow through a typed client-action metadata builder for enable/disable, quota increase, renewal, used-traffic reset, reset-policy update, and IP-limit changes, keeping top-level inbound metadata and structured `metadata.clients[]` synchronized for runtime artifacts, read models, and subscription binding.
- Customer-node-created subscription binding metadata and copy-all link generation now live in a feature-level helper with tests, so `AppShell` no longer owns the Xray-client-to-subscription identity mapping logic.
- Public subscription output now emits conversion diagnostic headers for selected, URI-converted, and unconverted node counts so format/rendering issues are visible without parsing the generated body.
- Public subscription output now excludes local Xray clients that are operator-disabled, runtime-policy disabled, expired, or over quota while still projecting matched Xray quota/expiry guardrail state into subscription diagnostics and traffic headers.
- Subscription output API and OpenAPI contracts now accept Shadowrocket and Stash formats for generated output and export profiles, matching the producer registry instead of rejecting formats the renderer can already serve.
- Subscription export profile UI now exposes Shadowrocket and Stash as selectable client/output targets, so operators can submit the formats already supported by the Domain, API contract, OpenAPI spec, and renderer.
- Subscription client rule UI now treats public output formats as first-class selections, including Shadowrocket and Stash, and the link drawer/copy/QR flows render from `outputFormats` instead of legacy export-file `formats`.
- Customer-node-created subscription bindings now enable the same Shadowrocket and Stash output formats that their generated preview URLs and quick-action copy-all flows expose, preventing public links from being previewed but rejected by the backend format gate.
- A minimal public subscription portal route now exists at `/portal/{securePath}/{subId}`, sharing the public subscription enabled/expiry/quota checks and showing enabled output links, expiry, usage, and generated-node status.
- Public subscription portal requests now consume the same per-identity `requestLimitPerHour` bucket as public subscription downloads, and invalid subscription expiry timestamps fail closed as expired.
- Public subscription downloads and portal requests now support an optional `accessTokenHash` gate; protected identities require a matching raw token via query string or bearer auth, HTTP task mutations can submit one-time `metadata.accessTokenRaw` for pre-persistence hashing, and HTTP JSON/SSE responses redact `accessTokenHash` / `tokenHash`.
- Public subscription portal links now include per-format QR SVGs; QR targets use forwarded public host/protocol headers when present and preserve token-protected query links when a customer enters through a valid raw token.
- Public subscription downloads and portal requests now distinguish quota exhaustion from non-quota runtime policy suspension, returning `subscription.runtime_disabled` with the preserved guardrail reason when an identity is manually or policy disabled.
- Public subscription portal rendering now uses the same Xray/external-node runtime projection as downloads, so traffic usage, generated-node count, access status, and guardrail reason are not stale copies from the original subscription task.
- Control-plane backup package generation now strips subscription `accessTokenHash` / `accessTokenRaw` and Agent `tokenHash` fields before preflight, so copied backup JSON does not contain those token materials.
- Subscription client/source/profile/export mutations now flow through feature-level task input builders instead of `AppShell` hand-assembling generic task metadata, with API-contract tests and idempotency keys that cover runtime-affecting fields such as enabled state, filters, quotas, formats, templates, and proxy groups.
- Subscription link drawers now expose the customer portal URL with copy/open actions, so the backend portal route is discoverable from the operator workflow.
- SQLite storage now has a schema v2 migration with a rebuildable `control_plane_entity_index` projection for core domain entities while preserving the compatible `json-state-v1` payload as the source of truth.
- The SQLite entity index now also projects subscription inventory nodes, runtime config revisions, preflight plans, and runtime snapshots using safe summary payloads, so runtime release state can be queried without unpacking the full JSON-state blob or duplicating sensitive artifact/state bodies.
- SQLite persistence now compacts high-frequency Agent heartbeat and telemetry events before writing the compatible JSON state row, defaults that window to 30 records per Agent/type with an environment override, and uses compact JSON serialization, reducing real Agent event CPU/write pressure while preserving command result, log chunk, task, preflight, revision, and snapshot evidence.
- Service-backed Agent heartbeat handling now uses a lightweight read-model update path after initial hydration, avoiding per-heartbeat task replay and quota/guardrail scans while preserving Agent liveness/session evidence.
- Service-backed Agent telemetry handling now reuses hydrated read-model tasks for quota reset replay, forwarding quota enforcement, and Xray guardrail comparisons, avoiding per-sample task reloads while preserving telemetry, traffic counters, and derived enforcement tasks.
- SQLite persistence now applies entity-index updates incrementally for normal task, command, subscription, runtime evidence, and traffic-rollup writes, so heartbeat/telemetry transactions no longer force a full `control_plane_entity_index` rebuild while preserving indexed runtime and traffic evidence.
- SQLite traffic-rollup retention pruning now deletes pruned `traffic-rollup` entity-index rows incrementally instead of rebuilding the full entity index on every telemetry sample, reducing real-Agent heartbeat/telemetry CPU pressure while keeping retained rollup query evidence accurate.
- Service-backed Agent heartbeat and telemetry ingestion now samples routine raw event persistence with `OU_UI_AGENT_EVENT_HIGH_FREQUENCY_PERSIST_EVERY` while still updating Agent session liveness and traffic rollups for every accepted event, reducing source JSON-state churn before SQLite compaction has to run.
- Task release evidence now includes safe Agent command outbox summaries from the control-plane snapshot, showing dispatch status, ACK/result timing, Agent ID, command ID, and command type without exposing the full runtime command payload in dashboard snapshot data.
- Xray runtime artifacts now carry a `control-plane-compiled` runtime diagnosis with planned inbound binding, `ou-ui-xray.service`, active/disabled client counters, quota/expiry/policy-disabled reasons, and next-action hints, and task release/failure evidence surfaces that diagnosis alongside Agent command/preflight/snapshot evidence.
- Agent result handling now stamps existing runtime diagnosis artifacts with `agent-result-verified` or `agent-result-failed`, so raw API evidence and task UI no longer disagree after a real runtime apply completes.
- Failed Xray Agent apply results with unhealthy runtime evidence now link the failed config revision, failed preflight plan, automatic rollback task, rollback command outbox item, and active runtime health alert in one tested service-backed evidence chain.
- A dedicated `smoke:xray-apply` production diagnostic now creates a real test Xray inbound through the public HTTP API, updates the same inbound, and waits for online Agent command completion, passed preflight, verified runtime snapshot, applied config revision, and `agent-result-verified` runtime diagnosis for both phases.
- Runtime apply snapshots now use per-task IDs instead of target-only IDs, and manual rollback resolves the latest matching pre-apply snapshot when no explicit snapshot is supplied, preventing same-target update tasks from breaking SQLite entity indexing or rollback evidence links.
- Service-backed Control Plane startup now hydrates its runtime sequence from persisted task, outbox, audit, and permission IDs before queuing new work, preventing post-restart task/config/outbox ID reuse from breaking SQLite entity indexing.
- Task release rows, task details, and failure drawers now include a runtime verification strip that summarizes command completion, Agent result stage, config revision, preflight, snapshot, and rollback linkage so operators can distinguish verified runtime success from merely compiled or waiting evidence.
- Xray customer-node read models now project Agent runtime deployment proof into the inbound model, and customer-node rows show a compact verified/waiting runtime evidence strip tied to Agent result, command IDs, config revision, and verification timestamp.
- Customer-node runtime evidence rows now open a focused diagnosis drawer backed by the current snapshot's task, command outbox, config revision, preflight plan, runtime snapshot, and rollback task evidence, with a direct path into the release-evidence workspace.
- Customer-node runtime evidence drawers now copy a safe structured diagnostic package with task, command, config revision, preflight, snapshot, rollback, and runtime diagnosis summaries while excluding raw command payloads, runtime snapshot state, and full artifact bodies.
- Customer-node runtime evidence drawers now expose the existing rollback flow for rollback-ready source tasks, letting operators move from verified release evidence to recovery without leaving the customer-node diagnosis context.
- Customer-node runtime evidence drawers now resolve linked rollback recovery evidence from the rollback task, rollback command outbox item, and restored runtime snapshot, and suppress duplicate rollback starts once a rollback task is already linked.
- Xray client enable/disable, traffic reset, renewal, quota, reset-policy, and IP-limit actions now have an explicit `applyXrayClientAction` Control Plane API plus `/api/v1/xray-client-actions` REST route that builds peer-preserving `inbound.update` tasks from live inbound read models and keeps runtime validation, command outbox, evidence, and rollback paths on the existing task pipeline.
- Customer-node single-row and bulk quick actions now call the explicit Xray client action API when the Control Plane provides it, falling back to metadata updates only for compatibility; bulk actions submit sequentially so the AppShell in-flight guard does not silently drop selected clients.
- Customer-node delete now uses the explicit Xray client action API as `delete-client`; shared inbounds submit a replacement `inbound.update` that removes only the target client while preserving peers, and final-client deletes still produce an `inbound.delete` runtime removal with risk confirmation before the subscription binding cleanup runs.
- `/api/v1/xray-client-actions` now also accepts `add-client`, appending a new client to an existing runtime inbound through a replacement `inbound.update` that preserves peer clients, validates duplicate identity/email/subscription-rule collisions, and keeps command outbox/runtime evidence on the existing Xray apply pipeline. A dedicated multi-client operator UI remains a follow-up milestone because the current customer-node table still renders one primary client row per inbound.
- Customer-node rows now expose a focused inbound clients drawer backed by the live `XrayInbound.clients[]` read model. Operators can inspect every client under the inbound, copy a per-client share URI, add a runtime client, and run per-client enable/disable, renewal, traffic increase, used-traffic reset, and delete actions through the explicit Xray client action API.
- Added shared-inbound Xray clients now also enqueue a traceable `subscription.generate` task from the same operator flow, using stable subscription identity, secure path preview, and all supported public output formats.
- Deleting a shared-inbound Xray client now resolves the matching subscription identity from live `SubscriptionClientIdentity` data or the stable Xray-client binding fallback, then queues `subscription.delete` only after the typed Xray client delete action is accepted. Non-primary client subscription token / secure-path rotation remains a follow-up item.
- The shared-inbound client drawer now surfaces inline runtime apply evidence for the inbound and per-client subscription task evidence, so operators can see Agent verification state plus recent `subscription.generate` / `subscription.delete` status without leaving the client workflow.
- The shared-inbound client drawer now receives the accepted Xray runtime task id and linked subscription task id from the operator mutation path, then shows a contextual action feedback bar after add/disable/renew/reset/delete so the operator can immediately trace queued work before Agent verification evidence refreshes.

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
- Keep runtime-supported protocols behind the shared `XRAY_RUNTIME_PROTOCOLS` boundary and avoid claiming Hysteria2, WireGuard, or TUN are production runtime features until actual Agent support exists.
- Keep customer-node UI, API schemas, read models, guardrail tasks, and runtime artifacts aligned so unsupported protocols cannot become editable/applyable Xray runtime inbounds by accident.
- Reject same-Agent Xray listener conflicts before enqueue when another inbound or in-flight task owns the same listen address/port with a different runtime protocol.
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
  - optional access token hash validation
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
