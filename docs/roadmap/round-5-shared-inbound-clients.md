# Round 5 - Shared Inbound Multi-Client Subscription Delivery

## Goal

Round 5 hardens the shared Xray inbound multi-client workflow so operators can see subscription delivery state directly beside each client, instead of jumping between client actions, subscription tasks, and generated links.

## UI/UX Pro Max Guidance Used

The UI work follows the `ui-ux-pro-max` guidance for dense operations dashboards:

- keep operational evidence near the action surface;
- use clear status language instead of color-only signaling;
- expose recovery / diagnostic data inline;
- keep actions compact but labelled;
- avoid fake success states when the binding is only derivable or blocked.

## Implemented

- `NodesPage` now accepts live `SubscriptionClientIdentity[]` data and receives it from `AppShell` in both host and customer-node workspaces.
- The shared inbound client drawer now resolves each Xray client to either:
  - a bound subscription identity from live subscription clients;
  - a deterministic preview binding when no live identity exists yet;
  - a blocked delivery state when the client, policy, expiry, quota, or subscription identity disables delivery.
- Each client row now shows a compact `Subscription Delivery` panel with:
  - delivery state (`Identity Bound`, `Preview Binding`, `Needs Attention`);
  - subscription identity;
  - `subId`;
  - secure path;
  - supported output formats;
  - customer portal URL;
  - blocked reasons when relevant.
- Operators can copy all delivery links from the drawer using existing URI / V2Ray / Clash / Mihomo / sing-box / Shadowrocket / Stash generation logic.
- Operators can copy a safe delivery diagnostic package that includes inbound, client, delivery, and subscription-task state without client credentials, passwords, command payloads, runtime snapshot bodies, or subscription token hashes.

## Validation

- Added coverage to `src/features/nodes/nodes-page.test.tsx` for:
  - live subscription identity binding;
  - preview binding for an unbound peer client;
  - generated delivery links;
  - safe diagnostic copy payload;
  - existing per-client typed runtime actions still working.

## Remaining Follow-Ups

- Non-primary client token and secure-path rotation still belongs to the subscription/customer-portal rounds.
- QR rendering for each peer client should be added with the Round 8 customer delivery work.
- Runtime Agent smoke should be rerun after deployment to prove the drawer remains aligned with real Xray client action evidence.
