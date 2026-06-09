# Global Quick Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global quick-action palette so operators can search hosts, customers, forwarding rules, subscription clients, and pages from the top bar and jump directly to the right workspace.

**Architecture:** Keep the feature inside the existing AppShell layout and navigation model. Build a small focused `QuickActionPalette` component that receives already-loaded read models and emits `PageId` navigation events, avoiding new data fetching or dependencies.

**Tech Stack:** Vite, React 19, TypeScript, Vitest, Testing Library, Tailwind CSS, lucide-react.

---

### Task 1: AppShell Quick-Action Behavior

**Files:**
- Modify: `src/components/layout/app-shell.test.tsx`
- Modify: `src/components/layout/app-shell.tsx`
- Modify: `src/components/layout/topbar.tsx`
- Create: `src/components/layout/quick-action-palette.tsx`
- Test: `src/components/layout/app-shell.test.tsx`

- [x] **Step 1: Write the failing test**

Add a test that renders seeded inventory, opens the global quick action from the top bar, searches `Acme`, sees matching subscription and forwarding resources, and jumps to Subscription Management after selecting the subscription result.

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/layout/app-shell.test.tsx -t "opens global quick actions"`

Expected: FAIL because the quick action button and dialog do not exist.

- [x] **Step 3: Implement the component**

Create `src/components/layout/quick-action-palette.tsx` with a controlled search input, grouped result rows, keyboard-safe buttons, empty state, and bilingual labels.

- [x] **Step 4: Wire it into AppShell and Topbar**

Add a top-bar search button visible on all pages, derive quick-action items from navigation, agents, customers, forwarding rules, and subscription clients, and close the palette after navigation.

- [x] **Step 5: Run targeted verification**

Run: `npx vitest run src/components/layout/app-shell.test.tsx -t "opens global quick actions"`

Expected: PASS.

- [x] **Step 6: Run focused shell tests**

Run: `npx vitest run src/components/layout/app-shell.test.tsx`

Expected: PASS for the AppShell suite in the current sandbox.

### Follow-up: Subscription Link Distribution

The subscription identity table now exposes a link drawer with per-format public URLs, copy/open actions, all-format bulk copy, and QR-code download for each generated format. This follows the 3x-ui-style `subId` distribution flow while keeping OU-UI's source, inventory, profile, and export-file layers separated.
