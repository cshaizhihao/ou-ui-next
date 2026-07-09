# Round 11 - Subscription Guardrail Derived State

## Goal

Round 11 tightens traffic, quota, expiry, and runtime-policy consistency for subscription delivery.

The specific gap fixed in this round: the subscription link drawer already blocked expired identities in the delivery brief, but copied diagnostics and the drawer guardrail field could still report `active` when `runtimeDisabledByPolicy` was missing and the identity was expired or over quota by derived evidence.

## Implemented

- Subscription guardrail display now derives policy state from expiry and actual quota usage, not only explicit `runtimeDisabledByPolicy` / `quotaExceeded` flags.
- Expired subscription identities now report `subscription_client_expired` in drawer guardrail state and copied diagnostics when no stronger guardrail reason exists.
- Over-quota subscription identities now report `subscription_client_quota_exceeded` when the used bytes exceed the traffic limit but no explicit reason exists.
- Explicit non-`ok` guardrail reasons are preserved, so manually suspended or backend-projected policy states are not overwritten.
- Delivery status, copied diagnostics, and customer delivery package now use the same derived guardrail helper.

## UI/UX Pro Max Guidance Used

Round 11 follows the `ui-ux-pro-max` operational-feedback guidance:

- avoid contradictory status surfaces in the same drawer;
- keep policy evidence text-based and copyable;
- derive the visible state from the same facts that block delivery;
- do not show a customer identity as active when expiry or quota already blocks runtime delivery.

## Validation

- `src/features/subscriptions/subscription-mixer-page.test.tsx` now verifies that an expired subscription without explicit runtime-disabled metadata:
  - shows blocked delivery state;
  - displays `subscription_client_expired` in the guardrail field;
  - copies `Guardrail: subscription_client_expired` in diagnostics.

## Remaining Follow-Ups

- Move subscription guardrail derivation into a shared domain helper so UI, public output, quota policy projection, and diagnostics cannot drift again.
- Add a backend projection test for subscription identities that are expired by `expiresAt` but lack explicit `runtimeDisabledByPolicy`.
- Add monthly reset window evidence to the copied delivery package once reset history is exposed as first-class read-model data.
