# Round 8 - Subscription Delivery Package

## Goal

Round 8 makes subscription handoff more operationally useful by turning the existing link drawer and executable delivery check into one copyable customer delivery package.

The target is not another UI-only form. Operators need a single artifact that combines:

- customer identity and delivery readiness;
- portal and selected client output links;
- quota, expiry, request-limit, and guardrail state;
- generated-node evidence;
- executable delivery-check status when available.

## Implemented

- The subscription link drawer now has a `Copy Delivery Package` / `复制客户交付包` action next to the executable delivery check.
- The delivery package includes a timestamped customer section using the same delivery diagnostics already shown in the UI.
- The package includes portal and selected output links generated from the live client identity, not hardcoded format assumptions.
- When the executable delivery check has not run yet, the package explicitly says `Delivery Check: Not Run` instead of implying a successful runtime check.
- After a delivery check runs, the package includes the same HTTP status, content type, `subscription-userinfo`, node-count, conversion-count, producer, and error evidence that the operator sees in the drawer.
- The existing standalone delivery diagnostics and delivery-check copy flows remain unchanged.

## UI/UX Pro Max Guidance Used

Round 8 follows the `ui-ux-pro-max` console workflow guidance:

- keep the action where the operator is already diagnosing delivery;
- reduce support handoff friction with a single copyable evidence bundle;
- separate static delivery readiness from executable runtime verification;
- do not present an unchecked link as verified;
- keep operator-visible evidence text-based rather than color-only.

## Validation

- `src/features/subscriptions/subscription-mixer-page.test.tsx` now verifies:
  - blocked subscriptions can still copy a package with customer/link evidence and `Delivery Check: Not Run`;
  - successful executable checks are included in the copied package after the operator runs delivery diagnostics;
  - existing delivery diagnostic copy behavior remains intact.

## Remaining Follow-Ups

- Persist the last delivery-check result per subscription identity so operators can reopen the drawer without losing recent evidence.
- Add optional redacted public-token fingerprints to the package when the backend exposes a safe immutable token identifier.
- Add a downloadable support bundle once backend audit IDs and request IDs are threaded through public subscription responses.
