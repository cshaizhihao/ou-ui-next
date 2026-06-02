# OU-UI Next v1.0 Design Spec

## Goal

Build OU-UI Next as a production-grade Master-to-Any distributed gateway and traffic distribution control panel. The product must preserve the supplied HTML demo as the visual constitution while adding real engineering structure, typed business models, task/audit flows, API contracts, and a path to a real Go backend plus agent runtime.

## Non-Negotiable UI Constitution

The file `C:/Users/Administrator/Desktop/UI/OU-UI Next - Ultimate Edition.html` is the source of truth for visual language. The implementation must preserve:

- Glass-Island layout with floating sidebar, main work area, login overlay, drawer, and modal surfaces.
- `html.dark` theme control and Tailwind dark-mode semantics.
- `btn-glow`, `glass-input`, `glass-toggle`, `island-panel`, `island-card`, `ambient-orb`, `bg-grid`, `logo-cat`, `page-view`, `stagger-*`, `drawer-panel`, and `modal-panel` visual behavior or exact semantic equivalents.
- SVG traffic flow animation using animated gradient stops and `stroke-dashoffset`.
- Mouse-position-based 3D tilt cards.
- Staggered page entrance animation.
- The supplied `cat-logo.png` brand asset.

New pages and components may expand the information architecture, but they must remain visually native to this design system.

## Product Architecture

OU-UI Next is split into five layers:

1. Frontend control plane UI
   - React/Vite/Tailwind dashboard, typed API contracts, realtime event adapters, mock mode, theme/i18n, and UI state.
2. Backend control plane
   - Authentication, RBAC, node registry, module registry, config compiler, task orchestration, audit logging, metrics ingestion, and API surface.
3. Universal Agent
   - Lightweight node-side runtime for heartbeat, telemetry, command execution, module lifecycle, config apply, hot reload, and rollback.
4. Module runtimes
   - Xray, GOST, Hysteria2, FLVX, and future modules installed and controlled by the Agent rather than hardcoded into the Agent.
5. Config compiler
   - Converts typed business intent into module-specific JSON/YAML with validation, diff preview, deployment tasks, and rollback snapshots.

## Core Domains

### Agents

Agent records represent server-side Universal Agent instances. They track identity, connection mode, heartbeat, version, platform, capabilities, module inventory, resource telemetry, and last command state.

### Nodes

Nodes represent managed service endpoints attached to one Agent. A node can host multiple modules and protocol inbounds. Nodes are not permanently specialized; Master can inject or remove modules.

### Modules

Modules represent installable runtime capabilities: Xray, GOST, Hysteria2, FLVX, BBR tuning helpers, and future plugins. Each module has lifecycle state, version, config status, health, and rollback metadata.

### Protocol Inbounds

Protocol inbounds model Xray-style access endpoints with protocol, transport, TLS/Reality, limits, owner, subscription exposure, and generated links.

### Tunnels And Forwarding

FLVX-style tunnels and forwarding rules support TCP/UDP, port forwarding, tunnel forwarding, account-level quota, one-way/two-way billing, per-user/per-tunnel rate limits, group permissions, batch operations, and panel federation.

### Subscriptions

Subscriptions support external source import, self-hosted node pool selection, node dedupe, tag/routing groups, generated client formats, access tokens, expiry, traffic headers, and audit logs.

### Tasks

All risky operations are represented as tasks: deploy Agent, install module, compile config, apply config, reload module, stop/start service, update tunnel, batch redeploy, rollback, and system tuning. Tasks must expose queued, running, succeeded, failed, retrying, rolled back, and canceled states.

### Audit

Every state-changing action must produce an audit record with actor, scope, operation, target, before/after summary, task ID, timestamp, source IP placeholder, and result.

## Capability Matrix

| Domain | Source | OU-UI Next Module | MVP | v1.0 |
| --- | --- | --- | --- | --- |
| Subscription aggregation | miaomiaowu, miaomiaowuX | `SubscriptionHub` | Import external sources, manage self-hosted nodes, export Clash/Mihomo and URI formats | Multi-client output, tokenized access, traffic headers, access statistics, compatibility filtering |
| Policy templates | miaomiaowu | `PolicyTemplateEngine` | Built-in groups and route templates | YAML merge, rule providers, DNS merge, node rename/delete synchronization |
| Xray ingress | 3X-UI, miaomiaowuX | `XrayIngressManager` | VLESS, VMess, Trojan, Shadowsocks inbounds | Reality/TLS/fallback, Hysteria/WireGuard/Mixed/Tunnel, schema-driven forms, hot reload |
| User and quota limits | 3X-UI | `IdentityQuotaMeter` | Traffic and expiry limits | IP limits, reset windows, disable-on-exhaustion, subscription usage headers |
| Master/SubAgent orchestration | miaomiaowuX, FLVX | `NodeOrchestrator` | Registration token, heartbeat, online/offline state, deploy command | WebSocket/HTTP/Pull fallback, upgrades, rollback, reconnect redeploy |
| Runtime config | miaomiaowuX | `RemoteRuntimeConfig` | Read/apply Xray configs | ACME, Nginx/fallback templates, config diff, health checks, rollback |
| Tunnel fabric | FLVX | `TunnelFabric` | Tunnel CRUD, TCP/UDP, port forwarding | Multi-hop chains, diagnostics, quality probing, node failover redeploy |
| Forwarding rules | FLVX | `ForwardRuleEngine` | Rule CRUD, target address, port allocation, start/stop | Batch actions, migration, conflict detection, runtime cleanup |
| Quota and billing | FLVX, 3X-UI | `QuotaPolicyCenter` | User and tunnel traffic quotas | One-way/two-way billing, per-user/tunnel limits, quota reset and recovery |
| Group permissions | FLVX | `AccessGroupMatrix` | User groups and tunnel groups | Permission grants, batch authorization, owner-scoped management, backend enforcement |
| Observability | miaomiaowuX, 3X-UI, FLVX | `ObservabilityDeck` | Node status, module status, traffic summary | Realtime speed, diagnostics, failure reasons, notifications, retention policy |

## Frontend Tech Stack

- React + Vite + TypeScript.
- Tailwind CSS with class-based dark mode.
- TanStack Router for pages.
- TanStack Query for API/server state.
- Zustand for UI state such as theme, overlays, selected rows, and mock session.
- React Hook Form + Zod for forms and config validation.
- i18next for simplified Chinese default text and future locale expansion.
- Recharts only where a full charting library is useful; the demo SVG flow chart remains code-native SVG.

## Backend Direction

The first implementation phase starts with typed frontend contracts and a mock adapter. The production backend should be Go-based, because the reference projects and target deployment model are Go-friendly. The backend should expose stable versioned APIs and keep database access behind repository/service layers.

Recommended backend modules:

- `auth`: session, token, RBAC.
- `agents`: registration, heartbeat, command channel.
- `nodes`: node and module inventory.
- `compiler`: config schema, diff, render, snapshot.
- `tasks`: orchestration, status updates, retries, rollback.
- `audit`: append-only operation records.
- `subscriptions`: import, normalize, aggregate, export.
- `forwarding`: tunnel and forwarding rule contract.
- `metrics`: telemetry, traffic, speed, history.

## Reference Project Capability Integration

- miaomiaowu informs subscription import, proxy groups, node dedupe, generated subscription formats, external traffic aggregation, and user subscription permissions.
- miaomiaowuX informs Master/SubAgent mode, remote deployment, connection fallbacks, remote Xray/Nginx config management, certificate workflow, and traffic collection.
- 3X-UI informs Xray protocol breadth, inbound/client modeling, user traffic/expiry/IP limits, subscription link generation, and database migration awareness.
- FLVX informs tunnels, forwarding, quotas, group permissions, rate limits, batch actions, and panel federation.

These projects define capability expectations. OU-UI Next must keep its own visual system and domain language.

## First Execution Slice

The first execution slice produces a working v0.1 foundation inside the v1.0 goal:

- React/Vite app initialized.
- Visual constitution migrated faithfully.
- Core layout, pages, overlays, theme, animations, and logo working.
- Typed domain models and mock API layer created.
- Main control pages populated from mock API, not hardcoded markup.
- Task center and audit log functional in mock mode.
- Build and browser verification passing.

The first slice must prioritize the task/audit loop. Any operation such as deploying an Agent, applying a node config, creating a forwarding rule, generating a subscription URL, or injecting a kernel tuning command must create a `DeployTask` and `AuditLog` entry.

## Testing Strategy

- Pure logic uses TDD with Vitest: task state transitions, audit generation, mock API contracts, route inventory, and domain model guards.
- Component behavior uses React Testing Library: page smoke, overlay open/close, theme toggle, and form submission behavior.
- Browser verification checks visual fidelity, responsive behavior, drawer/modal focus, dark/light theme contrast, 3D tilt, SVG flow animation, and core workflows.
- Browser screenshots are compared against the supplied HTML demo for at least five concrete points before handoff.

## Risks

- Visual drift from the supplied HTML demo if generic component libraries take over the style.
- Domain model fragmentation if pages define independent fake types.
- Task model omitted from early UI, causing risky operations to become simple buttons.
- Subscription, Xray, and FLVX concepts colliding unless they are modeled as separate domains with explicit bridges.
- Agent commands and module runtime logic becoming coupled too early.
- Missing CSS definitions in the demo such as `status-dot` and `status-online`; the React migration must define them instead of silently losing status indicators.
- Mobile layout pressure from fixed desktop shell dimensions; v1.0 must keep desktop density while adding a stable mobile navigation collapse.

## Success Criteria

- The app looks like the supplied demo, not like a generic admin template.
- The app runs as a modern typed frontend.
- Core workflows are interactive in mock mode.
- Domain models are ready for a real backend.
- Risky actions flow through tasks and audit logs.
- The first slice can be extended toward real Master/Agent runtime without rewriting the UI.
