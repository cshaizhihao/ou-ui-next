# Round 4 Xray Customer Node Cockpit

Round: 4 - Xray customer node workspace  
Date: 2026-07-07  
Scope: customer-node cockpit summary, runtime evidence shortcuts, policy-risk focus, and test coverage for the new operator entry point.

## Skill Inputs

This round used `ui-ux-pro-max` with the required design-system search path:

- Product direction: self-hosted Xray operations cockpit.
- Style: data-dense dashboard.
- Density: 9/10.
- Motion: subtle.
- Critical checks: accessible labels, keyboard-reachable buttons, clear loading/status evidence, table-safe responsive layout, and no color-only status meaning.

The applied UI direction was a compact operations band rather than another decorative card stack. The band is designed to answer four operator questions before they enter row-level drawers:

- How many runtime inbounds and client profiles are currently in scope?
- Which runtime evidence states are verified, waiting, or failed?
- Which clients are subscription-bound versus manual?
- Which policy or expiry risks need attention first?

## Implemented Decisions

### Cockpit Overview Band

The customer-node workspace now starts with an `Xray Customer Node Cockpit` region when customer nodes are available.

The cockpit derives its numbers from existing read models and runtime evidence:

- total and filtered customer-node counts.
- enabled and disabled node counts.
- total client count across shared inbounds.
- shared inbound count.
- subscription-bound versus manual delivery count.
- runtime evidence states: verified, waiting, failed.
- policy risk and soon-expiring counts.
- protocol distribution for runtime-supported Xray protocols.

No demo data or fabricated runtime state was added.

### Runtime Evidence Entry Point

When a failed customer-node runtime evidence bundle exists, the cockpit exposes `Open Failed Evidence`.

That button opens the existing focused customer-node runtime evidence drawer. The drawer remains backed by task, command outbox, config revision, preflight plan, runtime snapshot, rollback, and runtime diagnosis evidence already available in the snapshot.

### Policy Risk Focus

When a quota, expiry, policy-disabled, or non-ok guardrail reason exists, the cockpit exposes `Focus Risk Node`.

That action:

- clears customer-node filters.
- searches for the first risk node by node name.
- selects that node so the existing contextual action bar appears.

This keeps the operator inside the workspace and points them toward the existing typed client-action and diagnosis flows.

### Filter Recovery

The cockpit exposes `Clear Filters` as a stable recovery action.

It resets customer-node search, protocol filter, host filter, and status filter. This avoids dead-end filtered states after the operator follows a risk or evidence shortcut.

## UI and Runtime Alignment

The cockpit is read-model and evidence driven:

- It does not submit runtime tasks by itself.
- It does not claim new Agent runtime capability.
- It does not promote unsupported protocols into editable Xray runtime inbounds.
- It uses the existing `XRAY_RUNTIME_PROTOCOLS` boundary through `RuntimeXrayInbound` filtering.
- It routes operators into already implemented drawers, action bars, and runtime evidence paths.

## Tests Guarding This Round

`src/features/nodes/nodes-page.test.tsx` now covers:

- cockpit region rendering in the customer-node workspace.
- multi-client shared inbound count.
- subscription delivery summary.
- verified, waiting, and failed runtime evidence summary.
- policy-risk and expiry summary.
- opening the failed runtime evidence drawer from the cockpit.
- focusing a risk node and surfacing the contextual action bar.
- clearing customer-node filters from the cockpit.

## Non-goals

- No new Xray Agent apply behavior was added in this round.
- No new multi-client mutation flow was added beyond the existing drawer and typed client action paths.
- No subscription token or secure-path rotation behavior was changed.
- No forwarding or tunnel behavior was changed.
- No logo or brand asset was changed.
- No Preview or Roadmap capability was documented as implemented.

## Carryover

- Round 5 should deepen the shared-inbound multi-client operator flow so add/delete/disable/renew/quota/link/QR operations can be completed with fewer context switches.
- Round 6 should run and harden a real Agent Xray apply/client-action smoke against the current cockpit evidence paths.
- Round 7 should use the same cockpit pattern for Agent capability drift, installation recovery, and self-update diagnostics.
- Round 8 should reuse the delivery/risk/evidence summary language for subscription customer portal readiness.
