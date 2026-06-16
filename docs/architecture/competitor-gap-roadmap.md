# Competitor Gap Roadmap

Last updated: 2026-06-16

This roadmap turns the 3x-ui, miaomiaowu, miaomiaowuX, flvx, and UI review inputs into the remaining work for OU-UI Next. The references are capability inputs only. OU-UI Next should keep its own control-plane architecture: typed intent, task orchestration, audit evidence, Agent-mediated runtime changes, and explicit production acceptance gates.

## Source Repos And Commits

| Reference | Repository | Commit |
| --- | --- | --- |
| 3x-ui | `MHSanaei/3x-ui` | `f3eba04...` |
| miaomiaowu | `iluobei/miaomiaowu` | `a70ceda...` |
| miaomiaowuX | `iluobei/miaomiaowuX` | `457717d...` |
| flvx | `Sagit-chu/flvx` | `3ce320d...` |

## What OU-UI Next Already Does Better

OU-UI Next is already ahead of the reference projects in the areas where production control-plane safety matters most.

- Task-first operations: risky work is modeled as `DeployTask` lifecycle state rather than direct form mutation.
- Audit and evidence: state changes, denied requests, release acceptance, external receipts, runtime evidence, and strict verification paths are first-class product surfaces.
- Agent command discipline: command leases, ACK/result deadlines, late-result rejection, log chunks, session progress, and runtime credential inventory are defined and partially implemented as control-plane primitives.
- Runtime proof model: config revision, preflight plan, snapshot, apply result, health verification, rollback task, and alert projection are treated as required proof rather than incidental logs.
- Public subscription hardening: external source sync has SSRF protections, verified public-address pinning, body limits, fetch budgets, audit outcomes, tokenized public access, quota blocking, and sanitized read models.
- Operational UI posture: the product direction is dense, calm, evidence-led, and intentionally avoids marketing pages, generic admin shells, giant decorative forms, and visual effects that obscure task/audit boundaries.

## P0 Backlog

P0 work closes gaps that block a defensible production release or make competitor-parity workflows appear successful without runtime proof.

### Xray Runtime Spec And Apply Proof

- Finish end-to-end Xray compile -> diff -> preflight -> snapshot -> apply -> reload -> verify -> commit coverage for inbound, client, Reality, TLS, fallback, transport, quota, expiry, and subscription exposure changes.
- Define and test the canonical Xray runtime artifact schema, including server-only Reality material, client subscription material, stable inbound/client IDs, config revision, checksum, signature digest, and rollback snapshot references.
- Require Agent-reported `appliedConfigRevision` plus health proof before Master can mark an Xray task as succeeded.
- Add automated failure-path coverage for config-check failure, port conflict, Reality/TLS validation failure, reload failure, post-apply health failure, and rollback failure.
- Keep unimplemented protocol families or runtime adapters marked as preview in API and UI until the runtime proof chain exists.

### Subscription Templates, Producers, Provider Model, And Portal

- Stabilize shared subscription types for source, inventory node, client identity, export profile, proxy group template, generated file, provider account, and public portal access.
- Complete the workbench model for source ingestion, inventory selection, node grouping, export profiles, and mobile-safe assignment controls.
- Define producer contracts for Clash/Mihomo, Sing-box, URI lists, and future format plugins, including compatibility filtering, node rename/delete behavior, and redaction rules.
- Add provider-account models for remote source budgets, fetch limits, egress allowlists, provider health, and billing/cost export placeholders.
- Harden the public subscription portal around token scope, quota-exceeded denial, response headers, download audit, rate limits, and sanitized customer-facing error states.

### Permission, Quota, Forwarding Batch, And Tunnel UI

- Stabilize permission and quota enforcement types across customer node, subscription user, forwarding account, tunnel, forwarding rule, managed host, resource group, and operator group scopes.
- Require backend enforcement and denied-audit evidence for permission grants, revokes, quota resets, quota exceedance, and auto pause/resume flows.
- Finish forwarding batch actions as task-backed workflows with per-target result proof, partial-failure summaries, rollback affordances, and conflict projection.
- Make tunnel and forwarding UI expose TCP/UDP, one-way/two-way billing, rate limits, account quotas, owner/resource-group permissions, and runtime state without collapsing them into one oversized form.

### UI Shell And Nodes Polish

- Keep the current compact subscription cockpit direction, but bring node, runtime, forwarding, quota, and security surfaces to the same evidence-led density.
- Separate live state, desired state, pending task state, and historical evidence visually across managed-host and node detail surfaces.
- Add explicit runtime version, module capability, config revision, snapshot inventory, service health, telemetry gap, and upgrade/rollback affordances in node views.
- Remove remaining generic admin rhythms where tables, cards, and drawers do not communicate ownership, reversibility, or proof.

## P1 Backlog

P1 work improves parity depth after the P0 contracts are stable.

### Xray Runtime Spec And Apply Proof

- Add schema-driven forms for broader Xray protocol and transport combinations after the artifact schema is stable.
- Add richer health probes for Xray API status, traffic counters, certificate validity, Reality targets, and subscription link reachability.
- Add diff views that map business intent to runtime JSON without exposing secret material.
- Add operator-facing rollback inventory with snapshot age, active revision, changed files, health summary, and retention status.

### Subscription Templates, Producers, Provider Model, And Portal

- Add template composition for route rules, proxy groups, DNS merge, rule providers, and provider-specific overrides.
- Add import diagnostics for duplicate nodes, incompatible transports, unsupported protocols, expired upstream entries, and provider budget exhaustion.
- Add customer portal views for subscription links, QR codes, expiry, quota usage, format selection, and safe rotation of access tokens.
- Add provider sync observability: last fetch, next eligible fetch, status, warnings, byte budget, daily budget, and sanitized failure reason.

### Permission, Quota, Forwarding Batch, And Tunnel UI

- Add batch permission assignment and revoke previews with affected subjects, resources, risk labels, and last-administrative-path guardrails.
- Add quota impact previews for reset, limit change, disable-on-exhaustion, and auto-restore behavior.
- Add forwarding migration and redeploy flows that keep old/new bindings, protocol set changes, and stale service cleanup visible.
- Add tunnel diagnostics for route quality, binding health, port conflicts, and account-level usage pressure.

### UI Shell And Nodes Polish

- Add keyboard-first bulk selection, command palette targets, and consistent action drawers for dense operator workflows.
- Align all high-risk drawers around the same layout: intent summary, affected resources, proof requirements, impact preview, confirmation, task result.
- Add mobile and tablet audits for long localized labels, dense tables, bottom navigation, drawer focus, and no horizontal overflow.
- Retire compatibility-only `Glass*` visual remnants where `ou-*` surfaces already provide the canonical design language.

## P2 Backlog

P2 work captures advanced parity and ecosystem features that should follow the production-safe core.

### Xray Runtime Spec And Apply Proof

- Add optional module adapters beyond Xray and port forwarding, such as GOST extensions, kernel tuning, and future runtime plugins, only through allowlisted operations.
- Add multi-host staged rollout, canary health gates, automatic rollback thresholds, and compatibility matrix checks by Agent/runtime version.
- Add external artifact storage, real cryptographic signing, immutable snapshot archival, and release-bundle cross-linking.

### Subscription Templates, Producers, Provider Model, And Portal

- Add advanced template inheritance, provider-specific profile packs, customer-specific overrides, and dry-run output comparison.
- Add provider billing export integrations and warehouse-ready subscription/source traffic pipelines.
- Add public portal localization and white-label-safe theming without changing the control-plane UI language.

### Permission, Quota, Forwarding Batch, And Tunnel UI

- Add federation-oriented forwarding and tunnel concepts after single-control-plane ownership and audit semantics are stable.
- Add richer quota policies such as burst windows, grace periods, pooled quotas, and provider-cost guardrails.
- Add policy simulation across permission, quota, subscription, and forwarding domains before operators commit bulk changes.

### UI Shell And Nodes Polish

- Add operator personalization for saved filters, dense table presets, workspace state, and evidence panel defaults.
- Add richer observability workspaces for latency histograms, command outbox aging, archive sink health, provider sync cost, and release evidence coverage.
- Add external alert-platform connectors and UI routing once the system-alert lifecycle and webhook fan-out are stable.

## Parallelization Map

The work can move quickly if shared contracts are stabilized before independent UI and runtime slices diverge.

| Track | Can Run In Parallel | Must Stabilize First |
| --- | --- | --- |
| Xray runtime proof | Agent adapter tests, compiler schema tests, UI diff/proof surfaces, health probe design | `RuntimeArtifact`, `ConfigRevision`, `PreflightPlan`, `RuntimeSnapshot`, command result verification, module capability fields |
| Subscription workbench | Source ingestion UI, inventory grouping UI, producer tests, public portal shell, provider sync diagnostics | `SubscriptionSource`, `SubscriptionInventoryNode`, `SubscriptionClientIdentity`, `ProxyGroupTemplate`, `SubscriptionExportProfile`, generated-file API |
| Permission and quota | Permission matrix UI, quota policy UI, denied-audit tests, quota alert surfaces | shared scope model, actor/resource group model, enforcement result schema, quota transition task contract |
| Forwarding and tunnel | Batch UI, conflict projection, diagnostics panels, rate-limit display, migration preview | forwarding rule contract, tunnel/account model, billing direction semantics, Agent apply proof for port-forwarding |
| UI shell and nodes | Responsive audits, node detail polish, runtime inventory panels, action drawer consistency | navigation taxonomy, canonical `ou-*` surface patterns, node/runtime/session read-model fields |

Recommended sequencing:

1. Stabilize shared domain types and versioned API fields for runtime, subscription, permission, quota, forwarding, and node read models.
2. Land P0 runtime proof and subscription producer contracts with focused tests.
3. Parallelize UI polish, provider diagnostics, permission/quota previews, and forwarding batch flows once the contracts stop moving.
4. Promote P1/P2 items only when they preserve task/audit/evidence boundaries and do not create direct runtime mutation paths.

## Non-Goals

- Do not copy the reference projects' monolithic database JSON model or couple UI forms directly to stored runtime blobs.
- Do not recreate giant all-in-one inbound, subscription, tunnel, or forwarding forms that hide proof, ownership, and rollback boundaries.
- Do not turn the product into a marketing-style UI with hero sections, generic SaaS copy, decorative cards, or ornamental motion.
- Do not let Agent-side code decide permissions, quotas, subscription access, or task success.
- Do not expose server-side secret material in subscription previews, diffs, generated files, logs, or public portal responses.
- Do not call unproven runtime adapters production-ready because the UI can model their intent.
