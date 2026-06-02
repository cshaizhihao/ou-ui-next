# OU-UI Next v1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production-grade foundation slice for OU-UI Next v1.0 by migrating the supplied HTML visual constitution into a typed React/Vite application with domain models, mock APIs, task/audit flows, and verification.

**Architecture:** Start with a frontend-first foundation that preserves the supplied UI exactly while replacing hardcoded demo behavior with typed state and mock API contracts. Keep backend and Agent boundaries explicit through interfaces so a Go backend can be added without rewriting the UI.

**Tech Stack:** React, Vite, TypeScript, Tailwind CSS, TanStack Router, TanStack Query, Zustand, React Hook Form, Zod, i18next, Vitest, Playwright or Browser plugin verification.

---

## File Structure

- `package.json`: project scripts and dependencies.
- `index.html`: Vite HTML entry.
- `src/main.tsx`: React entry.
- `src/app/App.tsx`: root application composition.
- `src/app/providers/*`: query, i18n, theme, and router providers.
- `src/styles/globals.css`: base body styles and Tailwind imports.
- `src/styles/glass.css`: migrated Glass-Island, button, input, toggle, overlay, and card classes.
- `src/styles/animations.css`: ambient orbs, SVG flow, stagger, tilt support, drawer/modal transitions.
- `src/assets/cat-logo.png`: copied brand asset.
- `src/components/ui/*`: reusable glass UI primitives.
- `src/components/layout/*`: sidebar, topbar, shell, background.
- `src/components/overlays/*`: drawer, modal, confirm, overlay host.
- `src/features/*`: feature pages and feature-specific components.
- `src/domain/*`: shared TypeScript domain models.
- `src/services/mock/*`: deterministic mock API and event simulation.
- `src/services/api/*`: typed API client boundaries.
- `src/stores/*`: UI stores.
- `src/i18n/*`: simplified Chinese default dictionary.
- `src/test/*`: test setup and fixtures.
- `docs/superpowers/specs/2026-06-01-ou-ui-next-v1-design.md`: design spec.

## Task 1: Scaffold React/Vite/Tailwind Foundation

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `tailwind.config.ts`
- Create: `postcss.config.js`
- Create: `src/main.tsx`
- Create: `src/app/App.tsx`
- Create: `src/styles/globals.css`
- Create: `src/test/setup.ts`

- [ ] **Step 1: Create project manifests and tool config**

Create a React/Vite/TypeScript/Tailwind project with scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint ."
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:

```powershell
npm install
```

Expected: dependencies install without errors.

- [ ] **Step 3: Add minimal React entry**

Implement `src/main.tsx` and `src/app/App.tsx` with a visible shell placeholder that imports `src/styles/globals.css`.

- [ ] **Step 4: Verify baseline build**

Run:

```powershell
npm run build
```

Expected: TypeScript and Vite build pass.

## Task 2: Migrate Visual Constitution

**Files:**
- Create: `src/styles/glass.css`
- Create: `src/styles/animations.css`
- Modify: `src/styles/globals.css`
- Copy: `C:/Users/Administrator/Desktop/UI/cat-logo.png` to `src/assets/cat-logo.png`
- Create: `src/components/layout/environment-backdrop.tsx`
- Create: `src/components/ui/glass-panel.tsx`
- Create: `src/components/ui/glass-card.tsx`
- Create: `src/components/ui/glow-button.tsx`
- Create: `src/components/ui/glass-input.tsx`
- Create: `src/components/ui/glass-toggle.tsx`

- [ ] **Step 1: Write class-preservation test**

Create a test that reads the exported visual class constants and asserts the core class names exist: `island-panel`, `island-card`, `btn-glow`, `glass-input`, `glass-toggle`, `ambient-orb`, `bg-grid`, `logo-cat`, `drawer-panel`, `modal-panel`.

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
npm test -- visual-classes
```

Expected: fails because constants and components do not exist.

- [ ] **Step 3: Migrate CSS and primitives**

Move the supplied CSS behavior from the HTML demo into `glass.css` and `animations.css`. Components must use the same class names or direct semantic equivalents.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm test -- visual-classes
npm run build
```

Expected: tests and build pass.

## Task 3: Layout Shell And Demo Page Routing

**Files:**
- Create: `src/app/router/routes.tsx`
- Create: `src/components/layout/app-shell.tsx`
- Create: `src/components/layout/sidebar.tsx`
- Create: `src/components/layout/topbar.tsx`
- Create: `src/features/dashboard/dashboard-page.tsx`
- Create: `src/features/nodes/nodes-page.tsx`
- Create: `src/features/forwarding/forwarding-page.tsx`
- Create: `src/features/subscriptions/subscription-mixer-page.tsx`
- Create: `src/features/routing/routing-page.tsx`
- Create: `src/features/tuning/tuning-page.tsx`

- [ ] **Step 1: Write route inventory test**

Assert the route config contains `dashboard`, `nodes`, `forwarding`, `subscriptions`, `routing`, `tuning`, `tasks`, and `audit`.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm test -- routes
```

Expected: fails because routes are not implemented.

- [ ] **Step 3: Implement shell and route pages**

Build the sidebar/topbar/page outlet using the supplied demo layout and text conventions.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm test -- routes
npm run build
```

Expected: route inventory passes and build passes.

## Task 4: Theme, Animation, Tilt, Overlay Engines

**Files:**
- Create: `src/stores/theme-store.ts`
- Create: `src/stores/overlay-store.ts`
- Create: `src/hooks/use-tilt-card.ts`
- Create: `src/components/motion/animated-page.tsx`
- Create: `src/components/charts/svg-traffic-flow-chart.tsx`
- Create: `src/components/overlays/overlay-host.tsx`
- Create: `src/components/overlays/glass-drawer.tsx`
- Create: `src/components/overlays/glass-modal.tsx`

- [ ] **Step 1: Write behavior tests**

Test theme toggles `document.documentElement.classList`, overlay store opens/closes drawer/modal state, and `useTiltCard` computes bounded rotate values from pointer position.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm test -- theme overlay tilt
```

Expected: fails because stores/hooks do not exist.

- [ ] **Step 3: Implement engines**

Implement theme store, overlay store, tilt hook, animated page wrapper, and SVG traffic flow component.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm test -- theme overlay tilt
npm run build
```

Expected: tests and build pass.

## Task 5: Domain Models And Mock API Contracts

**Files:**
- Create: `src/domain/agent.ts`
- Create: `src/domain/node.ts`
- Create: `src/domain/module.ts`
- Create: `src/domain/protocol.ts`
- Create: `src/domain/forwarding.ts`
- Create: `src/domain/subscription.ts`
- Create: `src/domain/routing.ts`
- Create: `src/domain/task.ts`
- Create: `src/domain/audit.ts`
- Create: `src/services/api/client.ts`
- Create: `src/services/mock/mock-data.ts`
- Create: `src/services/mock/mock-api.ts`

- [ ] **Step 1: Write domain contract tests**

Assert that mock APIs return typed agents, nodes, modules, forwarding rules, subscription sources, tasks, and audit records with required production fields.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm test -- domain mock-api
```

Expected: fails because domain models and mock API do not exist.

- [ ] **Step 3: Implement models and mock API**

Implement deterministic mock data with professional DevOps/SRE terminology and no decorative placeholder names.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm test -- domain mock-api
npm run build
```

Expected: tests and build pass.

## Task 6: Wire Core Pages To Mock API

**Files:**
- Modify: `src/features/dashboard/dashboard-page.tsx`
- Modify: `src/features/nodes/nodes-page.tsx`
- Modify: `src/features/forwarding/forwarding-page.tsx`
- Modify: `src/features/subscriptions/subscription-mixer-page.tsx`
- Modify: `src/features/routing/routing-page.tsx`
- Modify: `src/features/tuning/tuning-page.tsx`
- Create: `src/features/tasks/tasks-page.tsx`
- Create: `src/features/audit/audit-page.tsx`

- [ ] **Step 1: Write page smoke tests**

Render key pages and assert they show mock API values for agents, forwarding rules, subscription sources, task states, and audit records.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm test -- pages
```

Expected: fails because pages are not wired to data.

- [ ] **Step 3: Connect pages to query hooks**

Use TanStack Query hooks backed by mock API adapters. Replace static table rows with mapped domain data.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm test -- pages
npm run build
```

Expected: tests and build pass.

## Task 7: Task Center, Audit, And Risky Operation Flow

**Files:**
- Create: `src/features/tasks/task-center.tsx`
- Create: `src/features/tasks/task-timeline.tsx`
- Create: `src/features/audit/audit-log-table.tsx`
- Create: `src/services/mock/task-simulator.ts`
- Modify: feature action buttons in nodes, forwarding, subscriptions, routing, and tuning pages.

- [ ] **Step 1: Write task transition tests**

Assert risky actions create a task, append an audit record, transition through queued/running/succeeded or failed, and expose retry/rollback metadata.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm test -- tasks audit
```

Expected: fails because simulator and task flows do not exist.

- [ ] **Step 3: Implement task and audit flows**

Wire dangerous operation buttons to task creation and audit logging instead of inert clicks.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm test -- tasks audit
npm run build
```

Expected: tests and build pass.

## Task 8: Browser Visual And Interaction Verification

**Files:**
- Create: `docs/qa/2026-06-01-v1-foundation-visual-qa.md`

- [ ] **Step 1: Start dev server**

Run:

```powershell
npm run dev
```

Expected: Vite serves a local URL.

- [ ] **Step 2: Open app in browser**

Use Browser plugin first when available; otherwise use Playwright with a recorded fallback reason.

- [ ] **Step 3: Verify desktop and mobile**

Check login, navigation, dark/light theme, drawer, modal, tilt card, SVG flow chart, task center, audit log, and mobile layout.

- [ ] **Step 4: Record QA results**

Write visual comparison notes against the supplied HTML demo, including at least five checked points and any intentional deviations.

- [ ] **Step 5: Run final checks**

Run:

```powershell
npm test
npm run build
```

Expected: all tests and build pass.

## Self-Review Checklist

- Every supplied UI constitution item maps to a file or task.
- Every reference-project capability has a destination domain.
- Risky operations are represented by task and audit flows.
- The first slice is realistic and testable.
- Backend/Agent work is not hidden inside frontend code.
