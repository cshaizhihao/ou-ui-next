# OU-UI Next V1.0 Production Acceptance Matrix

Last updated: 2026-06-06

This matrix is the working acceptance gate for the production V1.0 target. It separates the final product requirement from demo-compatible or mock-only behavior.

## Product Boundary

- OU-UI Next is a Chinese-first Master-to-Any control plane for distributed gateway, traffic distribution, Xray runtime, port forwarding, subscriptions, telemetry, and audit workflows.
- The product must remain usable by a first-time operator through one-click install, update, repair, reset, credential lookup, and uninstall commands.
- The supplied HTML/Tailwind UI demo is the visual constitution. The product keeps the glass island layout, `backdrop-filter`, physical 1px borders, `btn-glow`, SVG flow, 3D tilt cards, staggered page entrance, dark/light class mode, and cat logo tone.
- Demo-only behavior is not accepted as completion. Fake hosts, random telemetry, hardcoded Agent names, hardcoded customer nodes, or create-then-success state transitions must be removed from production paths.

## Deployment Gate

- Fresh install pulls from `https://github.com/cshaizhihao/ou-ui-next` and does not require a pre-cloned local checkout.
- Local deployment verification uses port `8778` unless a test explicitly states otherwise.
- Domain deployment target is `ouui.zze.cc`; nginx changes must not replace unrelated applications on the same server.
- Installer-created low-memory build swap must be explicitly disclosed before install and cleaned during `ou-ui uninstall` by disabling the swap and removing the exact `fstab` entry before deleting the state directory.
- `ou-ui reconfigure` must preserve the existing panel secure path, operator login credentials, backend operator token, session secret, Agent bootstrap token, and control-plane state while changing port, domain, SSL, or nginx wiring.
- The final browser entry must show the OU-UI Next frontend login page, not a browser Basic Auth prompt.
- Browser-side control-plane API, SSE, and Prometheus proxy routes must require a valid HttpOnly operator session before nginx injects the backend operator bearer token; session-backed `/api/v1` mutations must reject missing `X-CSRF-Token` with `403 csrf.required`, while bearer-token automation without a session cookie and `/agent/v1/*` Agent routes remain exempt. Generated login passwords must not be embedded in the frontend bundle, and installer-managed backend service authentication should verify an operator password hash rather than require plaintext in the service environment.
- Upgraded installs that still carry default or weak operator credentials must be diagnosable without printing secrets in `ou-ui doctor`, and the management CLI must provide a one-command random credential rotation that updates the backend password hash, removes backend plaintext compatibility, and invalidates existing browser sessions.
- Operator sessions must be recorded server-side, listable through protected `/api/v1/operator-sessions`, revocable per session through `/api/v1/operator-sessions/{sessionId}/revoke`, and browser sign-out must call `DELETE /api/v1/auth/session`; session issue, revoke/logout, and expiry must append audit evidence, and revoked or expired sessions must fail subsequent protected requests with sanitized denied-auth audit evidence.
- Agent install/runtime credentials must be listable as sanitized summaries through the Security Policy workspace and protected `/api/v1/agent-credentials`; UI/API responses must not render raw tokens or `tokenHash`, and active runtime credentials must be revocable or rotatable with audit evidence.
- Installed Agents must be able to rotate their own still-active runtime credential before expiry through an authenticated Agent endpoint, persist the returned token locally, and continue polling without reusing the one-time install token; explicit revocation remains an immediate disconnect.
- The panel Nginx proxy must keep `/events/v1/tasks` and `/events/v1/system-alerts` as unbuffered `text/event-stream` responses.
- Installer output must print the full panel URL, secure path, generated username, and generated password.

## UI Gate

- Chinese is the default language. English is switchable through a dedicated control and must not leave mixed Chinese labels in English mode.
- Customer-node protocol drawers must keep default Chinese labels localized for ordinary field names such as flow, client fingerprint, Reality keys, fallback targets, and sniffing controls, while preserving a separate English copy path after language switch.
- The login title is `OU-UI Next 控制面板`.
- Username and password placeholders must not include `admin`.
- Security-policy seed/demo grants must not render `operator:admin`; the visible bootstrap demo principal is `operator:bootstrap-owner`.
- Product navigation uses production names: `客户管理`, `受控主机`, `客户节点`, `端口转发`, `订阅管理`, `分流策略`, `安全策略`, `系统调优`, `执行记录`, and `审计日志`.
- `客户管理`, `客户节点`, and `受控主机` must remain independent top-level pages. `客户节点` owns Xray inbound and customer-node configuration, while `受控主机` owns Agent enrollment, telemetry, host settings, and the one-click Agent install command.
- `探针` must not be used as the primary product term. Use `受控主机`, `Agent 主机`, or `主机代理` depending on context.
- The port forwarding module must be named `端口转发`; `FLVX` can appear only as reference-project documentation.

## Runtime Gate

- Clean install with no registered Agent must show an empty managed-host inventory.
- A generated Agent install command must register a real host without embedding customer node names; the host must appear as `provisioning` with registration version/platform/capability metadata before heartbeat or telemetry marks it online.
- Agent runtime must report heartbeat, online state, latency, CPU, memory, disk, load, service health, ingress traffic, and egress traffic.
- Service-backed host status must derive `online`, `degraded`, and `offline` from real Agent heartbeat or telemetry age; production must not leave a host permanently online after the Agent stops reporting.
- Agent runtime must execute `health` and `telemetry` commands explicitly. `telemetry` must emit a `telemetry_sample` read-model event, and unsupported command types must return failed results instead of acknowledged no-ops.
- Agent runtime local retry state must be bounded: heartbeat, telemetry, log, ACK, and result events may be queued while Master is unavailable, but the local queue must default to a finite cap, prune routine heartbeat/telemetry before command ACK/result evidence, and rotate local runner logs so the Agent state directory cannot grow without bound during a long outage.
- The execution workspace must expose retained Agent runtime log chunks with Agent, task, command, stream, timestamp context, and the current retention policy so operators can inspect real runtime output without reading local state files; the published Agent must emit bounded `log_chunk` events for command runtime output and result summaries after ACK and before result; when retention pruning removes raw chunks, it must also expose queryable/exportable UTC-day archive summaries with counts, bytes, sessions, time ranges, and content hashes for the pruned evidence, and configured production installs must append newly produced summaries to an external JSONL archive sink outside the control-plane state payload.
- Agent telemetry read models must flag sampling gaps from the last telemetry sample timestamp and the expected sampling interval, and must flag red high-latency samples from the configured probe thresholds; heartbeat alone must not hide a stopped telemetry sampler, and active Agent offline state, sampling gaps, high-latency alerts, plus required runtime service failures must be visible as system alerts through REST, snapshot, dashboard, and SSE.
- Operator diagnostics must expose a protected observability metrics snapshot and Prometheus scrape endpoint covering task states, completion latency, completion latency grouped by task operation, runtime apply latency grouped by module, rollback counts, command outbox backlog/lease/overdue/dead-letter counts, ACK/result latency, Agent offline/degraded counts, active alert severities and kinds including `audit.write_failed` and system-alert notification delivery health, Agent log retained chunk totals, retained log bytes and time ranges, Agent log archive bucket/chunk/byte/time-range totals, traffic rollup retained totals, per-dimension counts, earliest/latest sample timestamps, cumulative metered bytes, audit-chain verification state, denied audit counts, quota-exceeded audit counts, and HTTP-observed audit write failures.
- Configured production installs must append sanitized audit-chain hash anchors for committed audit logs to an external JSONL sink outside the control-plane state payload.
- HTTP-observed denied-audit write failures must be projected into the active system-alert lifecycle so operators can see audit ledger write failures through REST, snapshot, dashboard, SSE, metrics, and configured webhook notifications.
- Command outbox overdue and dead-letter state must be projected into the active system-alert lifecycle so operators can see stalled runtime delivery through REST, snapshot, dashboard, SSE, metrics, and configured webhook notifications.
- Runtime reload failures must be projected into the active system-alert lifecycle and resolve after a newer successful reload for the same runtime target.
- Quota policies in `exceeded` or `disabled_by_quota` state must be projected into the active system-alert lifecycle with scope, usage, limit, guardrail reason, and runtime-disabled evidence.
- System-alert notification deliveries that are overdue for retry or dead-lettered must be projected into the active system-alert lifecycle so operators can see broken external alert routing through REST, snapshot, dashboard, SSE, and metrics.
- Production request handling must emit structured logs with request, trace, task, command, and Agent identifiers without logging credentials or raw payload secrets.
- Command outbox poll responses must retain safe `leaseOwnerId` and `leaseSessionId` fields; authenticated Agent leases must identify the Agent credential ID without exposing runtime tokens.
- Agent registration must audit runtime credential issuance and denied registration attempts without logging raw install/runtime tokens or token hashes.
- Agent poll/events authentication failures and identity mismatches must write `audit.denied` without logging bearer tokens.
- Operator protected-route authentication failures must write `audit.denied` without logging bearer tokens, and repeated failures from the same source must be throttled with `429 operator_auth.rate_limited` after the configured window limit.
- Audit repository appends must reject duplicate audit IDs and file-backed state loading must reject duplicate audit IDs before serving the ledger.
- SQLite-backed control-plane storage must validate `schema_version` and `state_format` metadata before serving reads or writes, and backup/restore validation must reject unsupported future schema versions instead of silently downgrading the database.
- Audit verification must support both the persisted server-side chain and exported audit log arrays without mutating server state.
- High-risk task mutations must require explicit confirmation matching the task `operation` and `targetId`; missing or mismatched confirmation must be rejected and counted through `audit.denied`.
- Master task state must be driven by Agent ACK/result events. Agent command-backed runtime tasks cannot be manually marked succeeded; port forwarding cannot show `已分配` until every target Agent reports a successful deployment with the expected config revision, and telemetry samples must not promote a binding to allocated.
- Agent ACK/result/log events must be bound to the same command outbox `commandId`, `taskId`, and `agentId`; mismatched events must return `agent_event.command_task_mismatch` without recording the event, updating outbox state, or changing port-forwarding allocation.
- Port-forwarding rules must support explicit `停用` / `恢复` control. A paused rule must stay in the control-plane inventory, remove its live runtime service on the Agent, and project the binding as paused until resumed.
- Managed-host and port-forwarding monthly traffic must be projected through the current UTC billing window derived from `monthlyResetDay`; stale period telemetry must not keep quota usage or forwarding bills elevated after the reset date.
- Agent telemetry must persist host, port-forwarding, and Xray client counters into a protected, filterable, exportable, retention-bounded, compaction-backed, and observability-covered traffic rollup history, not only update current snapshot counters; operators must be able to export the selected dashboard dimension as traffic diagnostics, view the runtime default, control-plane override, and effective traffic rollup retention policy from the dashboard, save retention overrides through the protected API, query/export retention-pruned compacted buckets, append newly produced compaction buckets to an external JSONL archive sink when configured, view selected-dimension compaction archive totals and latest archive time from the dashboard, export the selected archive as JSONL from the dashboard, and monitor retained plus compacted rollup storage pressure through the metrics surfaces.
- Xray customer-node client usage must be fed by Agent-side runtime counters, not static seed values; current-period Xray client samples must update the corresponding customer node and ignore stale-period samples after reset, while guardrail-only samples must update quota/expiry state without replacing the last valid traffic counters.
- Xray customer-node read models must not project unsupported explicit inbound protocols as if they were deployable.
- Customer directory read models must be derived from real customer nodes, subscription identities, and port-forwarding owner names, not fake customer seed rows. Same-name customers must be deduped across sources, non-Latin customer names must remain distinct, aggregate usage must follow `max(customer-node usage, subscription usage) + forwarding usage`, and the frontend must expose that directory through an independent `客户管理` page rather than hiding customer ownership inside managed-host setup.
- Customer subscription usage and generated-node counts must be projected from the selected local Xray clients when runtime matches exist; static subscription task metadata is only a fallback.
- Public customer subscription downloads must be rejected with `subscription.quota_exceeded` when the subscription-user `user:*` quota is exhausted, and must resume after `quota.reset` establishes a new baseline.
- Subscription group/bundle views must be projected from current subscription sources, synced inventory nodes, and export profiles; static seed bundle rows cannot be the source of truth.
- External subscription source sync must reject unsupported URL protocols, localhost/private/local IP literals, hostnames that resolve to private/local IPs, and configured egress allowlist misses before remote fetch, enforce per-source request timeout and response size limits, and record the outcome as sync failure state plus audit-chain evidence.
- External subscription sync must detect cross-source duplicate nodes with the configured dedupe policy and expose non-sensitive sync warnings in the source read model.
- External subscription sync success, warning, and failure outcomes must be auditable through the audit hash chain.
- External subscription source sync must support non-sensitive provider-account daily fetch and response-byte budgets, persist the current UTC-day usage on the subscription source read model, and reject budget-exhausted syncs before another remote fetch.
- Custom subscription rules must support filtering by protocol, region, source, managed host, runtime status, customer, and traffic condition; the frontend subscription identity drawer must expose traffic condition as a dedicated control and persist it as a `traffic:*` rule instead of requiring operators to remember the raw expression syntax.
- External subscription source sync must parse provider traffic headers, persist source-level upload, download, total quota, and expiry snapshots when present, and surface the latest snapshot in the external source table.
- Xray customer-node quota or expiry guardrails must affect runtime configuration, not only UI state; disabled clients must be removed from the managed inbound until policy allows them again, and Master read models must re-enable clients that were disabled only by runtime guardrails after Agent-reported policy recovery.
- Xray customer nodes must compile real protocol-specific configuration and produce usable links or subscription output.
- Subscription output must produce valid Clash, Sing-box, and URI content from real customer/source/rule inputs.
- Local Xray inbounds with multiple clients must render subscription nodes per client and filter by subscription identity so one customer never receives another client's UUID, password, auth secret, usage, or share link.

## Verification Gate

- `npm run test`, `npm run lint`, `npm run typecheck`, and `npm run build` must pass for every production iteration.
- Each completed core module iteration must update README or architecture docs when behavior, install flow, or acceptance state changes.
- Each completed core module iteration must be committed and pushed to GitHub.
- Installer and update flows must write a deployed frontend build fingerprint and fail the panel self-check when the served static bundle does not match the current Git commit.
- Updates from older deployments that rebuilt and copied the current frontend without `build-info.json` must repair the missing fingerprint in the same run, but only when the deployed static tree matches the current `dist` output.
