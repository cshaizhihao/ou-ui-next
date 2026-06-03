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
ou-ui-next menu
ou-ui-next credentials
ou-ui-next update
ou-ui-next uninstall
```

`ou-ui-next credentials` prints the full panel URL, username, and password. The installer also creates `ou-ui` and `ouui` as equivalent shortcuts.

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
- API calls are proxied through nginx and injected with the backend operator token
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
