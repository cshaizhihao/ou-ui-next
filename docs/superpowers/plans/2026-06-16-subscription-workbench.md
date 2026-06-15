# Subscription Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the subscription area into a three-column workbench for source ingestion, inventory node grouping, and export profile generation, so operators can edit subscription files the way miaomiaowu-style workflows expect.

**Architecture:** Keep the current subscription read model and reuse the existing `SubscriptionSource`, `SubscriptionInventoryNode`, `SubscriptionClientIdentity`, and `ProxyGroupTemplate` shapes. Replace the current form-first layout with a workbench that separates source management, node selection, group composition, and export output while preserving the current save/delete task contract. Desktop gets a full three-column arrangement with drag/drop and resize affordances for small cards; mobile collapses to stacked selection and assignment panels with the same data model and no fake filler content.

**Tech Stack:** React 19, TypeScript, existing domain read models, existing task mutation callbacks, existing Playwright/Vitest test stack, existing Tailwind classes and design tokens.

---

### Task 1: Reframe the subscription page into a three-column workbench shell

**Files:**
- Modify: `src/features/subscriptions/subscription-mixer-page.tsx`
- Modify: `src/features/subscriptions/subscription-mixer-page.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
it('renders the subscription page as a three-column workbench with source, inventory, and export regions', () => {
  renderPage({ language: 'en' });

  expect(screen.getByRole('region', { name: 'External Sources' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Inventory Nodes' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Export Groups' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/features/subscriptions/subscription-mixer-page.test.tsx -t "three-column workbench"`
Expected: FAIL because the page still renders the old rail/workspace structure.

- [ ] **Step 3: Write minimal implementation**

```tsx
<WorkspaceCockpit aria-label="订阅工作台" className="subscription-workbench">
  <div className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[17rem_minmax(0,1fr)_19rem]">
    <section aria-label={t.sourcesTab} className="subscription-workbench-sources border border-[#07111F]/18 bg-[#FFFDF5] p-3" role="region">
      <SourceStatusList sources={sources} t={t} />
    </section>
    <section aria-label={t.inventoryTab} className="subscription-workbench-inventory border border-[#07111F]/18 bg-[#FFFDF5] p-3" role="region">
      <InventoryNodeWorkbench nodes={filteredInventoryNodes} selectedNodeIds={selectedInventoryNodeIds} onToggleNode={toggleInventoryNodeSelection} />
    </section>
    <section aria-label={profileT.proxyGroups} className="subscription-workbench-groups border border-[#07111F]/18 bg-[#FFFDF5] p-3" role="region">
      <ExportGroupWorkbench groups={exportGroupDrafts} onSaveProfile={saveProfile} />
    </section>
  </div>
</WorkspaceCockpit>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/features/subscriptions/subscription-mixer-page.test.tsx -t "three-column workbench"`
Expected: PASS with the new region labels present.

- [ ] **Step 5: Commit**

```bash
git add src/features/subscriptions/subscription-mixer-page.tsx src/features/subscriptions/subscription-mixer-page.test.tsx
git commit -m "refactor: introduce subscription workbench shell"
```

### Task 2: Turn export profiles into editable node groups with drag/drop assignment

**Files:**
- Modify: `src/features/subscriptions/subscription-mixer-page.tsx`
- Modify: `src/features/subscriptions/subscription-mixer-page.test.tsx`
- Modify: `src/domain/subscription.ts`
- Modify: `src/services/api/subscription-output.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('creates export groups from selected inventory nodes and proxy group settings', async () => {
  const user = userEvent.setup();
  const onSaveExportProfile = vi.fn();

  renderPage({
    language: 'en',
    subscriptionInventoryNodes: inventoryNodes,
    onSaveExportProfile
  });

  await user.click(screen.getByRole('button', { name: 'Add Profile' }));
  const drawer = screen.getByLabelText('Edit Export Profile');

  await user.click(within(drawer).getByRole('button', { name: /Add Selected Nodes/i }));
  await user.click(within(drawer).getByRole('button', { name: /Save/i }));

  expect(onSaveExportProfile).toHaveBeenCalledWith(
    expect.objectContaining({
      proxyGroups: [expect.objectContaining({ name: expect.any(String), strategy: expect.any(String), filterTags: expect.any(Array) })]
    }),
    'create'
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/features/subscriptions/subscription-mixer-page.test.tsx -t "export groups from selected inventory nodes"`
Expected: FAIL because the drawer still only edits a single text field for the group.

- [ ] **Step 3: Write minimal implementation**

```ts
type ExportGroupDraft = {
  id: string;
  name: string;
  strategy: ProxyGroupTemplate['strategy'];
  filterTags: string[];
  nodeIds: string[];
};

function createExportGroupDraftFromNodes(nodes: SubscriptionInventoryNode[]): ExportGroupDraft {
  return {
    id: `proxy-group-${Date.now()}`,
    name: 'Custom Group',
    strategy: 'select',
    filterTags: nodes.flatMap((node) => node.tags).slice(0, 6),
    nodeIds: nodes.map((node) => node.id)
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/features/subscriptions/subscription-mixer-page.test.tsx -t "export groups from selected inventory nodes"`
Expected: PASS and the saved metadata contains `proxyGroups` with the dragged or selected nodes encoded.

- [ ] **Step 5: Commit**

```bash
git add src/features/subscriptions/subscription-mixer-page.tsx src/features/subscriptions/subscription-mixer-page.test.tsx src/domain/subscription.ts src/services/api/subscription-output.ts
git commit -m "refactor: add editable subscription group drafts"
```

### Task 3: Add mobile-safe node assignment and compact card resizing behavior

**Files:**
- Modify: `src/features/subscriptions/subscription-mixer-page.tsx`
- Modify: `src/features/subscriptions/subscription-mixer-page.test.tsx`
- Modify: `src/components/layout/responsive-page.tsx` if the workbench needs a shared compact surface helper

- [ ] **Step 1: Write the failing test**

```ts
it('falls back to tap-to-assign controls on mobile without horizontal overflow', async () => {
  renderPage({ language: 'zh', subscriptionInventoryNodes: inventoryNodes });

  expect(screen.getByRole('button', { name: 'HK Premium VLESS 01' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'SG Backup VMess 01' })).toBeInTheDocument();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/features/subscriptions/subscription-mixer-page.test.tsx -t "tap-to-assign controls on mobile"`
Expected: FAIL until the responsive fallback is added.

- [ ] **Step 3: Write minimal implementation**

```tsx
<div className="hidden max-md:flex max-md:flex-wrap max-md:gap-2">
  {visibleInventoryNodes.map((node) => (
    <button key={node.id} className="subscription-node-chip" type="button">
      {node.name}
    </button>
  ))}
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/features/subscriptions/subscription-mixer-page.test.tsx -t "tap-to-assign controls on mobile"`
Expected: PASS and zero horizontal overflow in browser smoke.

- [ ] **Step 5: Commit**

```bash
git add src/features/subscriptions/subscription-mixer-page.tsx src/features/subscriptions/subscription-mixer-page.test.tsx src/components/layout/responsive-page.tsx
git commit -m "refactor: add mobile subscription assignment fallback"
```

### Task 4: Verify the workbench with lint, build, tests, diff check, and Playwright

**Files:**
- No code changes expected unless verification exposes a regression

- [ ] **Step 1: Run the full verification suite**

Run:
```bash
npm run lint
npm run build
npm run test
git diff --check
```
Expected: all commands exit 0.

- [ ] **Step 2: Run Playwright desktop and mobile checks**

Run:
```bash
node scripts/production-browser-smoke.cjs --base-url https://ou-ui.zze.cc --report /tmp/ou-ui-browser-smoke.json --skip-screenshots
node - <<'NODE'
const { chromium } = require('playwright');
(async() => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, locale: 'zh-CN' });
  const page = await context.newPage();
  await page.goto('https://ou-ui.zze.cc', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByLabel(/用户名|Username/i).fill('admin');
  await page.getByLabel(/密码|Password/i).fill('admin');
  await page.getByRole('button', { name: /安全登录|Secure Login/i }).click();
  await page.getByRole('heading', { name: /订阅管理|Subscription Management/i }).first().waitFor({ state: 'visible', timeout: 30000 });
  console.log(JSON.stringify({ overflowX: await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth) }));
  await browser.close();
})();
NODE
```
Expected: login and navigation succeed, and the mobile viewport reports no horizontal overflow.

- [ ] **Step 3: Commit and push**

```bash
git add .
git commit -m "refactor: ship subscription workbench"
git push origin refactor/master-control-plane-ui
```

### Task 5: Post-implementation audit

**Files:**
- Update plan notes if anything unexpected changed

- [ ] **Step 1: Audit requirements against evidence**

Check that the final code proves all of these:
- source ingestion is still preserved
- inventory nodes are separated from clients
- export groups are editable
- proxy groups still generate usable export files
- mobile mode uses non-overflowing fallback controls
- no fake filler text was added

- [ ] **Step 2: Record remaining gaps if any**

If a requirement is not proven by tests or browser evidence, keep the goal active and continue instead of declaring completion.
```

## Self-Review

Spec coverage:
- Three-column subscription workbench: Task 1.
- Editable node groups and export profile generation: Task 2.
- Mobile fallback and compact card behavior: Task 3.
- Verification and browser proof: Task 4.
- Requirement audit: Task 5.

Placeholder scan:
- No TBD/TODO placeholders remain in the actual implementation steps.
- Commands, file paths, and assertions are concrete.

Type consistency:
- `ProxyGroupTemplate`, `SubscriptionInventoryNode`, `SubscriptionExportProfile`, and `SubscriptionClientIdentity` are used consistently with existing domain types.
- The plan keeps the current task callbacks intact and only extends the metadata shape where needed.
