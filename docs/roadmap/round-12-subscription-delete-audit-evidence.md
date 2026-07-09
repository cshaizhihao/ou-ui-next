# Round 12 - Subscription Delete Audit Evidence

## Goal

Round 12 hardens a high-risk subscription operation by adding a copyable delete audit package before a subscription identity is removed.

The target is to make deletion traceable before the operator confirms the destructive action:

- identity and customer details;
- delivery readiness and guardrail state;
- public portal/output links affected by deletion;
- token/path previews without raw token material;
- generated-node impact.

## Implemented

- Subscription identity rows now expose `Copy Delete Audit` / `复制删除审计`.
- The action copies a timestamped `OU UI Subscription Delete Audit` package.
- The package includes the same customer diagnostics already used by delivery packages, keeping status/guardrail evidence aligned.
- The package includes public portal and selected output links so operators can capture what customer-facing access will be removed.
- The package includes generated node count, secure path preview, access-token preview, and derived guardrail state.
- Copying the audit package does not trigger the actual delete mutation.

## UI/UX Pro Max Guidance Used

Round 12 follows the `ui-ux-pro-max` destructive-action guidance:

- put evidence and recovery context beside the dangerous action;
- make pre-delete evidence copyable before confirmation;
- avoid raw secret exposure in support/audit artifacts;
- keep the destructive action itself behind the existing explicit confirmation path.

## Validation

- `src/features/subscriptions/subscription-mixer-page.test.tsx` now verifies:
  - the delete audit package can be copied from a filtered subscription identity row;
  - copying the package does not call `onDeleteClient`;
  - the copied text includes action, subId, delivery status, guardrail, portal link, generated-node impact, and secure-path preview.

## Remaining Follow-Ups

- Move delete audit package generation into a shared feature helper once subscription client row actions are split from the page.
- Add request ID / actor / idempotency evidence to the audit package when those are available at the row action boundary.
- Add the same pre-delete audit package pattern to external subscription sources and export profiles.
