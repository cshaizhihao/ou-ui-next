# Round 7 - Agent Recovery Capability Parity

## Goal

Round 7 aligns the Agent recovery UI with the runtime rules already enforced by the Control Plane:

- manual recovery / upgrade command previews require an active runtime credential;
- one-click remote Agent upgrade requires the Agent to advertise `self-update`;
- unsupported recovery actions must be visibly blocked before the operator clicks them.

The intent is to remove the previous "clickable but backend-denied" recovery behavior around telemetry gaps and ACK-silent runtime failures.

## Implemented

- `NodesPage` now receives sanitized `agentCredentials` from the live snapshot through `AppShell`.
- Agent recovery UI uses a single capability state model for:
  - copyable manual recovery command availability;
  - remote upgrade availability;
  - active runtime credential presence;
  - `self-update` capability presence;
  - `command-channel` capability warnings.
- Poll-only / sampling-gap host cards now show explicit recovery readiness copy instead of only switching buttons.
- Customer-node runtime evidence drawers now show the same recovery readiness model for ACK-silent failures.
- Manual recovery command actions are hidden and replaced with an explicit blocked reason when no active runtime credential exists.
- Remote upgrade is only offered when the Agent advertises `self-update`; otherwise the UI names that missing capability.
- The UI still allows manual recovery for legacy Agents with active runtime credentials, matching the backend `createAgentUpgradeCommand` path.

## UI/UX Pro Max Guidance Used

Round 7 follows the `ui-ux-pro-max` operational-console guidance:

- expose disabled state evidence next to the action;
- avoid fake success by checking capability and credential prerequisites before showing action buttons;
- keep recovery paths contextual in the same card/drawer where the operator sees the failure;
- use text evidence rather than color-only status.

## Validation

- `src/features/nodes/nodes-page.test.tsx` now models active runtime credentials in recovery scenarios.
- Existing host recovery tests still verify:
  - poll-only hosts can copy recovery commands when an active runtime credential exists;
  - remote upgrade is offered only for `self-update` Agents;
  - ACK-silent customer-node runtime failures can produce a recovery command when credential prerequisites are met.
- Service-backed Control Plane tests already enforce:
  - `agent_upgrade.runtime_credential_required`;
  - `agent_upgrade.self_update_unsupported`;
  - upgrade command audit evidence and token redaction.

## Remaining Follow-Ups

- Add a dedicated credential-status badge to the host readiness panel so operators can see runtime credential expiry before a recovery incident.
- Add an Agent self-update drift panel that compares installed script version, Agent binary version, and Control Plane expected runtime version.
- Extend install-command diagnostics with a structured "why this install did not become a runtime credential" path.
