# Round 10 - Forwarding Runtime Evidence Package

## Goal

Round 10 makes forwarding and tunnel operations easier to support by giving every rule a copyable runtime evidence package, not only failed or blocked rules.

Operators need the same evidence whether a rule is healthy, waiting, degraded, blocked, or failed:

- runtime diagnosis state and next actions;
- entry bindings and target path;
- runtime service names;
- quota and guardrail state;
- blocked Agent controls and blocked values.

## Implemented

- Ready forwarding rules now expose a `Copy Runtime Evidence` / `复制运行证据` action in the runtime evidence card.
- The copied package reuses the existing recovery-context evidence builder, so healthy and unhealthy rules share the same field set.
- The package title distinguishes normal evidence from recovery context: `Forwarding Runtime Evidence`.
- Existing failed-rule recovery cards still keep `Copy Recovery Context`, preserving the recovery-specific workflow.
- The evidence package includes binding paths, runtime services, quota, target, blocked controls, blocked values, reasons, and next actions.

## UI/UX Pro Max Guidance Used

Round 10 follows the `ui-ux-pro-max` operational-console guidance:

- keep support actions adjacent to the evidence they export;
- make healthy-state evidence copyable before an incident occurs;
- avoid hidden operational data by exposing service and binding evidence inline;
- keep one consistent evidence format across ready, blocked, degraded, and failed states.

## Validation

- `src/features/forwarding/forwarding-page.test.tsx` now verifies that ready rules can copy runtime evidence with:
  - state;
  - port status;
  - resolved Agent name and binding path;
  - runtime service name.
- Existing recovery-context tests continue to verify failed-rule recovery evidence.

## Remaining Follow-Ups

- Add a downloadable forwarding diagnostic bundle once runtime task request IDs and Agent result IDs are available at the rule row level.
- Persist the last health-check result per binding so copied evidence can include probe latency / HTTP or TCP health status.
- Add per-binding copy actions for multi-entry rules when a tunnel spans several Agents.
