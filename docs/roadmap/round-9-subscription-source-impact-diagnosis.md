# Round 9 - Subscription Source Impact Diagnosis

## Goal

Round 9 strengthens subscription import and conversion diagnosis by making source warnings explain their operational impact, not just list raw sync issues.

The target is to help operators answer:

- did this source fail entirely;
- how many nodes never became deliverable inventory;
- whether remaining warnings are expected filtering / dedupe effects;
- what action should happen before syncing again.

## Implemented

- Source sync diagnosis now derives an `Import / Conversion Impact` summary from real `syncWarnings`.
- Unsupported protocol and invalid-node warnings are treated as blocked deliverability impact.
- Filtered, deduped, and cross-source duplicate warnings are treated as review impact instead of hard failure.
- Remote sync failures are treated as failed impact and point operators to remote URL, auth, timeout, or response-size fixes.
- The source diagnosis drawer shows the new impact section next to existing sync status, remote config, rules, budget, and issue list.
- Copied source diagnosis packages now include impact summary and impact next action so support handoffs explain why nodes did or did not become usable.

## UI/UX Pro Max Guidance Used

Round 9 follows the `ui-ux-pro-max` diagnostic workflow guidance:

- convert low-level warning codes into user-facing outcome language;
- keep next actions adjacent to the evidence they explain;
- avoid color-only severity; the drawer uses explicit labels and counts;
- preserve raw codes only in copied diagnostic evidence, not in the primary UI.

## Validation

- `src/features/subscriptions/subscription-mixer-page.test.tsx` now verifies:
  - warning source drawers include an import/conversion impact region;
  - unsupported + invalid node counts are summarized as blocked deliverability impact;
  - copied source diagnosis contains both the impact summary and next action;
  - existing raw-warning hiding in the UI remains intact.

## Remaining Follow-Ups

- Persist structured sync counters from backend sync jobs so impact summaries do not need to infer counts solely from warning strings.
- Add per-format conversion impact once renderer output can attribute unconverted nodes back to source/node IDs.
- Add a source-level retry history panel with request ID, HTTP status, byte count, and parser outcome for each sync attempt.
