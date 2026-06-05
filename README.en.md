# OU-UI Next

> Master-to-Any distributed gateway, traffic fabric, and Universal Agent control plane.

OU-UI Next is a production-oriented control plane for distributed gateways, forwarding fabrics, subscription orchestration, and Universal Agent lifecycle management. It turns the supplied HTML/Tailwind blueprint into an engineered Vite + React + TypeScript product with a typed frontend, a service-backed HTTP control plane, contract-validated APIs, and deployment automation.

Documentation is available in two languages:

- English: this file
- Simplified Chinese: [README.zh-CN.md](README.zh-CN.md)

## Product Positioning

OU-UI Next is built for operators who need one place to:

- manage Master-to-Any node enrollment and Universal Agent deployment
- orchestrate forwarding, quotas, subscription synthesis, and routing policy
- enforce auditable task transitions with rollback evidence
- keep the day-one experience approachable without removing operational structure

The practical goal is simple:

> Beginner-friendly, ready to run.

The repository includes an interactive one-click Master installer that asks only the required questions, then automates the normal deployment path. It is intended to reduce hand-built nginx configuration, manual certificate handling, and fragile multi-step panel bootstrap work.

## Architecture Blueprint

```text
 OOOOOOO  UU   UU        UU   UU IIIII  NN   NN EEEEEEE XX   XX TTTTTTT
OO     OO UU   UU        UU   UU  III   NNN  NN EE       XX XX    TTT
OO     OO UU   UU ------ UU   UU  III   NN N NN EEEEE     XXX     TTT
OO     OO UU   UU ------ UU   UU  III   NN  NNN EE       XX XX    TTT
 OOOOOOO   UUUUU          UUUUU  IIIII  NN   NN EEEEEEE XX   XX   TTT

[ Architecture: Master-to-Any Distributed Modular Matrix ]

+========================================================================+
|                     MASTER NODE (Control Plane)                        |
|                                                                        |
|  +----------------+  +-------------------+  +-----------------------+  |
|  | UI Dashboard   |  | Deployment Engine |  | Core Database         |  |
|  | (React/Vite)   |  | (SSH / Installer) |  | (Nodes/Rules/Stats)   |  |
|  +----------------+  +---------+---------+  +-----------------------+  |
|                                |                                       |
|                      +---------v---------+                             |
|                      |  Config Compiler  |                             |
|                      +-------------------+                             |
+================================|=======================================+
                                 |
   [ Secure Control Channel : SSH Deploy / WebSocket / gRPC API ]
   [ Master dynamically injects Agents, Configs & Protocol Binaries ]
                                 |
+------------------+-------------+-------------+------------------+------+
|                  |             |             |                  |      |
v                  v             v             v                  v      v
+----------+    +----------+  +----------+  +----------+       +----------+
| HOST 001 |    | HOST 002 |  | HOST 003 |  | HOST ... |  ...  | HOST N   |
+----------+    +----------+  +----------+  +----------+       +----------+
| AGENT    |    | AGENT    |  | AGENT    |  | AGENT    |       | AGENT    |
+==========+    +==========+  +==========+  +==========+       +==========+
| [x]Xray  |    | [x]Xray  |  | [ ]Xray  |  | runtime  |       | [x]Xray  |
| [x]Fwd   |    | [ ]Fwd   |  | [x]Fwd   |  | modules  |       | [x]Fwd   |
| [x]Health|    | [x]Health|  | [x]Health|  | telemetry|       | [x]Health|
+----------+    +----------+  +----------+  +----------+       +----------+
| quota    |    | quota    |  | quota    |  | policy   |       | quota    |
+----------+    +----------+  +----------+  +----------+       +----------+
```

## Current Engineering Surface

This repository currently includes:

- **Vite + React + TypeScript frontend**
  - application shell, navigation, dashboard, node, forwarding, subscription, routing, security, tuning, task, and audit surfaces
- **Typed control-plane contracts**
  - OpenAPI spec: [docs/openapi/ou-ui-next-v1.yaml](docs/openapi/ou-ui-next-v1.yaml)
  - Zod request validation and API envelope handling
- **Service-backed HTTP control plane**
  - local backend entrypoint: `src/server/control-plane/http-control-plane-main.ts`
  - service/repository boundaries for tasks, audit, idempotency, outbox, runtime release models, and permission persistence
  - protected `/events/v1/tasks` streams cursor-resumable task and audit snapshots before live task/audit broadcasts in the same HTTP server instance; cross-instance fan-out and full historical task-status retention remain production hardening items
  - protected `/events/v1/system-alerts` streams the current active system-alert snapshot and emits a new snapshot when the derived alert fingerprint changes in the same HTTP server instance; alert lifecycle persistence and notification fan-out remain production hardening items
  - protected `/api/v1/observability-metrics` returns an operator diagnostics snapshot for task states, completion latency, rollback counts, command outbox backlog/leases/overdue/dead-letter counts, ACK/result latency, Agent offline/degraded counts, system-alert severity counts, audit-chain verification state, denied audit counts, and quota-exceeded audit counts
  - protected `/metrics` exposes the current diagnostics snapshot as Prometheus text gauges for external scraping
  - the production entrypoint emits JSON structured logs for HTTP requests, errors, tasks, Agent poll/events, and command dispatch with `requestId`, `traceId`, `taskId`, `commandId`, `agentId`, and related diagnostics fields
  - the installer-generated Nginx panel proxy keeps `/events/v1/*` unbuffered and explicitly returns `text/event-stream`, so browsers and reverse proxies treat control-plane events as SSE instead of regular HTML
  - runtime apply commands hash the canonical inline artifact JSON, and the Agent verifies checksum plus `sig-v1` digest before taking a local snapshot, running preflight, or writing runtime files
  - runtime preflight read models cover artifact integrity, config schema, port conflicts, runtime dependency availability, and rollback snapshots; failed Agent results mark the matching check and retain failed health summaries
  - successful Agent results must report the command's expected `appliedConfigRevision`; the Master converts missing or mismatched revisions into failed results and marks result verification failed
  - port forwarding read models show a binding as allocated only after every target Agent reports a successful, revision-verified result; Agent telemetry updates traffic and quota counters only, and manual task transitions cannot mark forwarding runtime tasks succeeded
  - managed-host and port-forwarding traffic read models compute UTC monthly billing windows from `monthlyResetDay`; Agents report `trafficBillingPeriod`, the Master accepts only current-period samples, and snapshot reads reset stale period usage while appending host, forwarding, and Xray client counters into the traffic rollup read model; the host telemetry read model derives sampling-gap state from the expected sampling interval and routes it as system alerts on managed-host cards, the dashboard, and `/events/v1/system-alerts`
  - Xray customer-node artifacts carry client traffic limits, manual usage calibration, and monthly reset days; Agents collect client uplink/downlink through Xray StatsService and report `xrayClientCounters` for Master-side customer-node usage projection
  - customer-node Xray runtime read models only project protocols that can currently be compiled and deployed: VLESS, VMess, Trojan, and Shadowsocks; unsupported explicit protocol requests do not create fake customer nodes
  - customer subscription read models and public subscription responses aggregate current usage and generated node counts from the selected local Xray clients; when runtime-backed customer nodes match, static `usedTrafficGb` / `generatedNodeCount` task metadata is only a fallback
  - subscription bundle read models are projected from current external sources, synced inventory nodes, and export profiles, so bundle health, source status, and generated node counts no longer depend on static seed bundles
  - external source sync only fetches `http` / `https` subscription URLs, blocks localhost and private/local IP literals plus hostnames that resolve to private/local IPs before fetch, can restrict outbound source hosts with `OU_UI_SUBSCRIPTION_SOURCE_EGRESS_ALLOWLIST`, and supports per-source remote request timeouts plus response body limits; timeouts, oversize responses, unsupported protocols, allowlist misses, and blocked targets become sync failure state and audit-chain entries
  - external source sync detects cross-source duplicate nodes with the current dedupe policy, marks the source as warning, and surfaces non-sensitive sync warnings in the source table
  - external source sync success, warning, and failure outcomes are appended to the audit hash chain with before/after source state, node counts, and warning codes
  - subscription rules can filter nodes by protocol, region, source, managed host, runtime status, customer, and traffic conditions; local Xray nodes carry customer, host, status, used-traffic, and quota metadata for rule matching
  - external subscription sync parses provider `subscription-userinfo` traffic headers, persists upload, download, total quota, and expiry snapshots on the subscription source read model, and surfaces them in the source table
  - when an Xray customer-node client exceeds its monthly quota or expires, the Agent filters that client out of the runtime inbound, rebuilds the Xray config, and reports `runtimeDisabledByPolicy` with the guardrail reason
- **Mock and HTTP adapter split**
  - the frontend can run against mock data for UI iteration
  - or target the service-backed HTTP control plane
- **Automated verification**
  - Vitest
  - ESLint
  - TypeScript typecheck
  - production Vite build

## One-Click Master Deployment

The operator-facing deployment entrypoint is:

```bash
sudo bash -c 'bash <(curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/scripts/install-master.sh)'
```

If you are already running as `root`, use:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/scripts/install-master.sh)
```

After installation, use the management shortcut at any time:

```bash
ou-ui menu
ou-ui credentials
ou-ui restart
ou-ui update
ou-ui fix
ou-ui repair-nginx
ou-ui reconfigure
ou-ui doctor
ou-ui reset-state
ou-ui uninstall
```

The shortest entrypoint is `ou`: running `ou` with no arguments opens the interactive maintenance menu.
If your server was installed with an older build and does not have `ou` / `ou-ui` yet, refresh the shortcuts first, then run `ou f --force` to repair the frontend, nginx surface, and stale state:

```bash
sudo bash -c 'bash <(curl -fsSL https://raw.githubusercontent.com/cshaizhihao/ou-ui-next/main/scripts/install-master.sh) repair-cli'
```

Status checks are split intentionally: `ou s` shows the systemd service state, while `ou d` runs the full installation doctor for nginx, Basic Auth, panel URL, service state, and the control-plane state file.
Before uninstalling, back up anything you need to keep. `ou x` / `ou-ui uninstall` removes the install directory, config directory, state directory, web root, nginx site, and systemd service.
`OU_UI_LOCAL_SOURCE_DIR` is intended for development/debug deployments only. Production updates should use the GitHub install path so `ou u` / `ou f` can pull the latest remote release directly.
Managed hosts also get an `ou-agent` shortcut after enrollment: `ou-agent` opens its menu, `ou-agent status` checks local Agent state, `ou-agent update` updates the Agent runtime from GitHub without re-registering or consuming a new install token, and `ou-agent uninstall` removes the host Agent.

Short aliases are installed automatically: `ou p` prints panel information, `ou c` prints login credentials, `ou rs` restarts the service, `ou u` updates from GitHub, `ou f` runs the one-click repair flow, `ou r` resets control-plane state, `ou m` changes port/certificate settings, `ou d` runs diagnostics, and `ou x` uninstalls the panel.

`ou-ui credentials` / `ou c` prints the full panel URL, username, and password. `ou-ui doctor` / `ou d` checks nginx, Basic Auth, service state, and the control-plane state file. `ou-ui fix` / `ou f` pulls the latest GitHub source, rebuilds the frontend, refreshes shortcuts, restarts services, rewrites the OU-UI nginx panel site, and runs a Basic Auth surface check. If a fresh install still shows stale demo data, run `ou fix --force` to clear the old control-plane state automatically. `ou-ui repair-nginx` rewrites the panel nginx config without rebuilding the frontend. `ou-ui reconfigure` / `ou m` reopens the installer to change the port, certificate, or nginx wiring. The installer also creates `ou-ui-next`, `ou-ui`, and `ouui` as equivalent shortcuts.

By default the installer pulls the `cshaizhihao/ou-ui-next` `main` branch from GitHub and builds it on the server. Users do not need to clone the repository first. Local source deployment is now an explicit development/debug path via `OU_UI_LOCAL_SOURCE_DIR=/path/to/ou-ui-next`.

What the installer currently does:

- displays an interactive install agreement
- asks for the Master panel port
- asks whether a domain already points to the host
- when a domain is available:
  - installs and configures `acme.sh`
  - requests a Let's Encrypt certificate
  - installs the certificate under the OU-UI Next config directory
  - writes nginx HTTPS configuration and reload behavior
- when no domain is available:
  - deploys through IP + port over HTTP
- always:
  - generates a 16-character secure path
  - generates a random admin username
  - generates a random admin password
  - generates an operator token for the backend proxy path
  - syncs the latest Master source from GitHub
  - deploys nginx, a systemd service, and persistent control-plane state directories
  - prints the final access URL and credentials at the end

### Zero-Config Intent

The installer is intentionally optimized for "ask less, automate more":

- panel access is protected by a generated secure path and the in-app login screen; the browser Basic Auth dialog should not appear
- the installer checks the deployed panel URL before finishing, verifies that it is serving the OU-UI Next frontend login page, and fails fast if a Basic Auth response is detected
- `8443` / `9443` are the recommended dedicated panel ports; `443` remains selectable, but the installer asks for explicit confirmation because it is the most likely port to collide with existing sites, reverse proxies, or old panels
- if a browser system-auth dialog appears, run `ou d` first to diagnose stale nginx sites, same-port conflicts, or Basic Auth leftovers; prefer avoiding `443` on reinstall unless you know it is free
- if the fresh install is not on the latest frontend, stale demo nodes still appear, shortcuts are missing, or the panel URL still returns Basic Auth, run `ou fix --force`; it updates from GitHub, rewrites the nginx panel site, clears old control-plane state, and verifies that the managed-host inventory is empty again
- API calls are proxied through nginx and injected with the backend operator token at the reverse-proxy layer; the operator token is not written into the frontend bundle
- Agent one-click install commands download `public/install/ou-agent.sh` from GitHub raw by default, avoiding dependency on local Master static files or panel login protection
- fresh production installs do not inject demo nodes; managed hosts appear only after an Agent registers
- Agent install commands only enroll the host and initialize runtime components; host name, monthly quota, expiry, and probe target are edited later in the panel
- SSL issuance and nginx wiring are automated when a valid domain is available
- IP + port deployment remains available for hosts without a domain

This is deployment automation for the current Master control-plane surface. Full multi-node production hardening, durable external database choices, operator identity policy, and Agent registration/rotation policy still need continued implementation and validation.

## Development

Install dependencies:

```bash
npm install
```

Run the frontend:

```bash
npm run dev
```

Run the service-backed control plane locally:

```bash
npm run start:control-plane
```

## Verification

Run the project checks:

```bash
npm run test
npm run lint
npm run typecheck
npm run build
```

## Repository Landmarks

- `src/app` - app shell, runtime config, navigation
- `src/components` - reusable UI primitives and layout scaffolding
- `src/features` - feature workspaces
- `src/server/control-plane` - service-backed Master control plane runtime
- `src/services/api` - typed API contracts, HTTP adapter, mock adapter bridge
- `docs/architecture` - backend and control-plane boundary notes
- `docs/openapi` - machine-readable API contract
- `scripts/install-master.sh` - one-click Master deployment entrypoint

## Delivery Direction

OU-UI Next is moving toward a production-grade V1 through incremental, verifiable work:

- modernized frontend implementation from the original UI blueprint
- typed domain and API contracts
- service-backed backend kernel
- task, audit, permission, and runtime state boundaries
- deployment automation focused on beginner-friendly Master installation

The repository has a practical foundation, but it should still be treated as an evolving V1 implementation rather than a fully hardened multi-node operations platform.
