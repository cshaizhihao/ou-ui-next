# Round 6 - Agent Xray Apply Eligibility and Evidence Parity

## Goal

Round 6 removes a real runtime verification blocker: Xray apply smoke and customer-node preflight previously required `agent.status === online`, even when the Agent command channel and `ou-ui-xray.service` were both active. A telemetry sampling gap could mark the Agent `degraded` and prevent real Xray apply verification despite runtime services being available.

## Implemented

- The production Xray apply smoke now uses an explicit **Xray apply-eligible** check instead of only `online` status.
- `online` Agents with `xray` capability remain eligible.
- `degraded` Agents are eligible only when both runtime service reports are explicitly active:
  - `ou-ui-agent.service` / module `agent`
  - `ou-ui-xray.service` / module `xray`
- Agents remain blocked when:
  - missing `xray` capability;
  - `offline` or `provisioning`;
  - runtime service evidence is missing for degraded status;
  - Agent/Xray service is inactive, failed, missing, or unknown;
  - host/runtime policy disables the Agent.
- Customer-node save preflight now uses the same eligibility semantics: telemetry gaps can stay visible as warnings without incorrectly blocking runtime apply when command and Xray services are active.
- Error messages now report why a candidate Agent is not apply-eligible, including runtime service status.
- Production Xray smoke now uses a 45s per-request timeout and labels timeout failures with the API method/path, so large snapshots or slow task creation no longer fail as anonymous request timeouts.
- Production Xray smoke now blocks by default when stale `xray-live-smoke-*` inbounds, active inbound runtime tasks, or pending/leased/acknowledged Agent command outbox items would pollute runtime evidence.
- A manual `--allow-dirty-smoke-state` switch exists for diagnosis only; it prints the dirty-state summary before continuing.
- Smoke-created clients now default to a 7-day TTL, reducing failed-run residue that can trigger next-day automatic expiry disable tasks.

## UI/UX Pro Max Guidance Used

The UI behavior follows the operations-dashboard guidance from `ui-ux-pro-max`:

- separate execution eligibility from monitoring quality;
- keep degraded telemetry visible as evidence, not as a fake hard failure;
- keep recovery detail near the save/apply decision;
- avoid color-only status by using explicit status copy.

## Validation

- Added smoke-script tests for degraded-but-eligible Agents and degraded Agents with failed Xray service.
- Added smoke-script tests for dirty-state blocking and the longer default smoke-client TTL.
- Added NodesPage tests showing a degraded Agent with active command/Xray services remains saveable and clearly explains the warning.
- Existing node runtime evidence tests still pass.

## Live 4174 / Agent Finding

- Browser smoke on `http://127.0.0.1:4174` passes login, navigation, and logout.
- Real Xray smoke verified the `inbound.create` phase against `agent-fb073c1d5053` with Agent result evidence: `task-5715` / `cfg-task-5715` reached `agent-result-verified`.
- The same live run then exposed a real operations blocker: old failed Xray smoke inbounds had expired and generated multiple automatic guardrail disable tasks, leaving a burst of Agent commands competing with the update/client-action smoke phases.
- The smoke script now fails closed on this dirty state by default instead of continuing to create additional runtime tasks.
- `/tmp` is a 1.9G tmpfs and was full during validation; npm/Vitest verification was run with project-local `TMPDIR`, `XDG_CACHE_HOME`, and `npm_config_cache` to avoid false ENOSPC failures.

## Remaining Follow-Ups

- Round 7 should extend this same capability parity model into Agent install, upgrade, and recovery actions.
- The live Agent still shows telemetry sampling gaps; this round keeps those warnings visible while allowing the runtime apply path to proceed when services are active.
- A future cleanup utility should safely enumerate and remove stale smoke-created inbounds after preserving evidence, instead of relying on ad hoc manual database edits.
