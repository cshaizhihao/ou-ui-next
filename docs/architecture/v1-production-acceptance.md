# OU-UI Next V1.0 Production Acceptance Matrix

Last updated: 2026-06-05

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
- The final browser entry must show the OU-UI Next frontend login page, not a browser Basic Auth prompt.
- The panel Nginx proxy must keep `/events/v1/tasks` and `/events/v1/system-alerts` as unbuffered `text/event-stream` responses.
- Installer output must print the full panel URL, secure path, generated username, and generated password.

## UI Gate

- Chinese is the default language. English is switchable through a dedicated control and must not leave mixed Chinese labels in English mode.
- The login title is `OU-UI Next 控制面板`.
- Username and password placeholders must not include `admin`.
- Product navigation uses production names: `受控主机`, `客户节点`, `端口转发`, `订阅管理`, `分流策略`, `安全策略`, `系统调优`, `执行记录`, and `审计日志`.
- `探针` must not be used as the primary product term. Use `受控主机`, `Agent 主机`, or `主机代理` depending on context.
- The port forwarding module must be named `端口转发`; `FLVX` can appear only as reference-project documentation.

## Runtime Gate

- Clean install with no registered Agent must show an empty managed-host inventory.
- A generated Agent install command must register a real host without embedding customer node names; the host must appear as `provisioning` with registration version/platform/capability metadata before heartbeat or telemetry marks it online.
- Agent runtime must report heartbeat, online state, latency, CPU, memory, disk, load, service health, ingress traffic, and egress traffic.
- Service-backed host status must derive `online`, `degraded`, and `offline` from real Agent heartbeat or telemetry age; production must not leave a host permanently online after the Agent stops reporting.
- Agent runtime must execute `health` and `telemetry` commands explicitly. `telemetry` must emit a `telemetry_sample` read-model event, and unsupported command types must return failed results instead of acknowledged no-ops.
- Agent telemetry read models must flag sampling gaps from the last telemetry sample timestamp and the expected sampling interval; heartbeat alone must not hide a stopped telemetry sampler, and active sampling gaps must be visible as system alerts through REST, snapshot, dashboard, and SSE.
- Operator diagnostics must expose a protected observability metrics snapshot and Prometheus scrape endpoint covering task states, completion latency, rollback counts, command outbox backlog/lease/overdue/dead-letter counts, ACK/result latency, Agent offline/degraded counts, active alert severities, audit-chain verification state, denied audit counts, and quota-exceeded audit counts.
- Production request handling must emit structured logs with request, trace, task, command, and Agent identifiers without logging credentials or raw payload secrets.
- Command outbox poll responses must retain safe `leaseOwnerId` and `leaseSessionId` fields; authenticated Agent leases must identify the Agent credential ID without exposing runtime tokens.
- Agent registration must audit runtime credential issuance and denied registration attempts without logging raw install/runtime tokens or token hashes.
- Audit repository appends must reject duplicate audit IDs and file-backed state loading must reject duplicate audit IDs before serving the ledger.
- Audit verification must support both the persisted server-side chain and exported audit log arrays without mutating server state.
- High-risk task mutations must require explicit confirmation matching the task `operation` and `targetId`; missing or mismatched confirmation must be rejected and counted through `audit.denied`.
- Master task state must be driven by Agent ACK/result events. Port forwarding cannot show `已分配` until every target Agent reports a successful deployment with the expected config revision; telemetry samples and manual task transitions must not promote a binding to allocated.
- Managed-host and port-forwarding monthly traffic must be projected through the current UTC billing window derived from `monthlyResetDay`; stale period telemetry must not keep quota usage or forwarding bills elevated after the reset date.
- Agent telemetry must persist host, port-forwarding, and Xray client counters into a queryable traffic rollup history, not only update current snapshot counters.
- Xray customer-node client usage must be fed by Agent-side runtime counters, not static seed values; current-period Xray client samples must update the corresponding customer node and ignore stale-period samples after reset, while guardrail-only samples must update quota/expiry state without replacing the last valid traffic counters.
- Xray customer-node read models must not project unsupported explicit inbound protocols as if they were deployable.
- Customer subscription usage and generated-node counts must be projected from the selected local Xray clients when runtime matches exist; static subscription task metadata is only a fallback.
- Subscription group/bundle views must be projected from current subscription sources, synced inventory nodes, and export profiles; static seed bundle rows cannot be the source of truth.
- External subscription source sync must reject unsupported URL protocols, localhost/private/local IP literals, hostnames that resolve to private/local IPs, and configured egress allowlist misses before remote fetch, enforce per-source request timeout and response size limits, and record the outcome as sync failure state plus audit-chain evidence.
- External subscription sync must detect cross-source duplicate nodes with the configured dedupe policy and expose non-sensitive sync warnings in the source read model.
- External subscription sync success, warning, and failure outcomes must be auditable through the audit hash chain.
- Custom subscription rules must support filtering by protocol, region, source, managed host, runtime status, customer, and traffic condition.
- External subscription source sync must parse provider traffic headers, persist source-level upload, download, total quota, and expiry snapshots when present, and surface the latest snapshot in the external source table.
- Xray customer-node quota or expiry guardrails must affect runtime configuration, not only UI state; disabled clients must be removed from the managed inbound until policy allows them again, and Master read models must re-enable clients that were disabled only by runtime guardrails after Agent-reported policy recovery.
- Xray customer nodes must compile real protocol-specific configuration and produce usable links or subscription output.
- Subscription output must produce valid Clash, Sing-box, and URI content from real customer/source/rule inputs.

## Verification Gate

- `npm run test`, `npm run lint`, `npm run typecheck`, and `npm run build` must pass for every production iteration.
- Each completed core module iteration must update README or architecture docs when behavior, install flow, or acceptance state changes.
- Each completed core module iteration must be committed and pushed to GitHub.
