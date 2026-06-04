# OU-UI Next V1.0 Production Acceptance Matrix

Last updated: 2026-06-04

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
- A generated Agent install command must register a real host without embedding customer node names.
- Agent runtime must report heartbeat, online state, latency, CPU, memory, disk, load, service health, ingress traffic, and egress traffic.
- Service-backed host status must derive `online`, `degraded`, and `offline` from real Agent heartbeat or telemetry age; production must not leave a host permanently online after the Agent stops reporting.
- Agent runtime must execute `health` and `telemetry` commands explicitly. `telemetry` must emit a `telemetry_sample` read-model event, and unsupported command types must return failed results instead of acknowledged no-ops.
- Master task state must be driven by Agent ACK/result events. Port forwarding cannot show `已分配` until every target Agent reports a successful deployment with the expected config revision; telemetry samples and manual task transitions must not promote a binding to allocated.
- Managed-host and port-forwarding monthly traffic must be projected through the current UTC billing window derived from `monthlyResetDay`; stale period telemetry must not keep quota usage or forwarding bills elevated after the reset date.
- Xray customer-node client usage must be fed by Agent-side runtime counters, not static seed values; current-period Xray client samples must update the corresponding customer node and ignore stale-period samples after reset.
- Customer subscription usage and generated-node counts must be projected from the selected local Xray clients when runtime matches exist; static subscription task metadata is only a fallback.
- Subscription group/bundle views must be projected from current subscription sources, synced inventory nodes, and export profiles; static seed bundle rows cannot be the source of truth.
- Xray customer-node quota or expiry guardrails must affect runtime configuration, not only UI state; disabled clients must be removed from the managed inbound until policy allows them again.
- Xray customer nodes must compile real protocol-specific configuration and produce usable links or subscription output.
- Subscription output must produce valid Clash, Sing-box, and URI content from real customer/source/rule inputs.

## Verification Gate

- `npm run test`, `npm run lint`, `npm run typecheck`, and `npm run build` must pass for every production iteration.
- Each completed core module iteration must update README or architecture docs when behavior, install flow, or acceptance state changes.
- Each completed core module iteration must be committed and pushed to GitHub.
