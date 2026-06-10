# Telegram Notifications MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overloaded Telegram notification settings page with a minimal Bot Token + Chat ID configuration panel that saves immediately with clear feedback.

**Architecture:** Keep the existing `TelegramNotificationSettingsPage` prop contract so `AppShell` and API integrations do not need churn. Remove binding, policy, delivery-history, and bulk retry UI from the page surface; the backend read models can continue to exist for now but are no longer exposed in this low-frequency settings panel.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, existing `GlowButton` and `GlassCard` UI primitives.

---

### Task 1: Replace Page Tests With MVP Behavior

**Files:**
- Modify: `src/features/telegram/telegram-notification-settings-page.test.tsx`
- Test: `src/features/telegram/telegram-notification-settings-page.test.tsx`

- [ ] **Step 1: Write failing tests**

Replace the legacy tests with tests proving:
- The page renders only Bot Token and Chat ID controls.
- Saving submits only `botToken`, `adminChatIds`, and `enabled: true`.
- Save shows a success message.
- The save button is disabled while `mutationBusy` is true.
- Legacy sections such as customer bindings, delivery history, notification policy, and test sending are not rendered.

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npx vitest run src/features/telegram/telegram-notification-settings-page.test.tsx
```

Expected: FAIL, because the current page still renders the old complex Telegram settings workflow.

### Task 2: Implement Minimal Telegram Settings Panel

**Files:**
- Modify: `src/features/telegram/telegram-notification-settings-page.tsx`
- Test: `src/features/telegram/telegram-notification-settings-page.test.tsx`

- [ ] **Step 1: Remove unused UI state and handlers**

Delete binding, challenge, policy, delivery filtering, evidence drawer, bulk retry, and test notification UI from `TelegramNotificationSettingsPage`.

- [ ] **Step 2: Keep only the useful draft state**

The component keeps:

```ts
type SettingsDraft = {
  botToken: string;
  chatId: string;
};
```

- [ ] **Step 3: Save minimal settings**

On submit, call:

```ts
await onUpdateSettings?.({
  enabled: true,
  ...(draft.botToken.trim() ? { botToken: draft.botToken.trim() } : {}),
  adminChatIds: splitList(draft.chatId)
});
```

Then clear the token field, preserve the returned/current chat ID, and show a success status.

- [ ] **Step 4: Run focused test**

Run:

```bash
npx vitest run src/features/telegram/telegram-notification-settings-page.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit and push**

Run:

```bash
git add docs/superpowers/plans/2026-06-10-telegram-notifications-mvp.md src/features/telegram/telegram-notification-settings-page.tsx src/features/telegram/telegram-notification-settings-page.test.tsx
git commit -m "Simplify Telegram notification settings"
git push origin main
```
