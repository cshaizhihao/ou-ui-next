# Round 2 Visual System Rebuild

Round: 2 - UI visual system rebuild  
Date: 2026-07-07  
Scope: design tokens, global visual language, workspace chrome, command surfaces, drawers, mobile navigation, and cockpit background normalization.

## Skill Inputs

This round used `ui-ux-pro-max` with `--design-system`, plus the local frontend design and design-system guidance.

The resulting direction is an operations control-plane UI:

- dense and scan-friendly instead of decorative.
- semantic runtime colors instead of raw saturated accents.
- restrained surfaces, stable borders, and purposeful focus states.
- compact command paths for operators who repeat tasks.
- light and dark modes backed by the same semantic token names.

The old fauvist/glass/glow assumptions are no longer the design target.

## Implemented Decisions

### Token Architecture

`src/styles/tokens.css` now owns the Round 2 visual contract:

- Primitive color ramps: ink, slate, blue, emerald, amber, red, cyan.
- Semantic colors: `--ou-bg`, `--ou-surface`, `--ou-border`, `--ou-text`, `--ou-primary`, `--ou-success`, `--ou-warning`, `--ou-danger`, `--ou-info`.
- Runtime states: `--ou-state-verified`, `--ou-state-pending`, `--ou-state-failed`, `--ou-state-info`.
- Component tokens: radius, shadow, transition, focus ring, scrim, container width.

The shared Tailwind theme now mirrors the same palette instead of the previous high-saturation bespoke deck.

### Core Chrome

The following surfaces now consume semantic classes and tokens:

- desktop sidebar.
- topbar search and global controls.
- operations launchpad.
- mobile bottom navigation and governance tray.
- quick action palette.
- action overlay.
- config drawer.
- control-plane loading skeleton.
- responsive workspace containers and mobile metric strip.

Core status mapping is:

- primary: command/search/navigation.
- success: verified/online/runtime OK.
- warning: pending/governance/attention.
- danger: destructive or high-risk operation.

### Cockpit Backgrounds

Feature cockpit backgrounds are normalized away from radial decorative color blocks. The shared cockpit classes now use:

- surface-to-subtle linear backgrounds.
- muted rails.
- low-contrast grid texture for workspace areas.

This keeps feature pages closer to an operations console while larger page-specific UX rebuilds remain scheduled for later rounds.

### Motion and Accessibility

This round keeps existing reduced-motion coverage and focus management, while moving visible focus and hover states onto semantic tokens.

No new decorative motion was added.

## Tests Guarding This Round

Updated tests now protect:

- `visualTokens.visualDialect === "ops-control-plane"`.
- the presence of primitive, semantic, and component token layers.
- absence of the old shared fauvist palette in shared theme files.
- launchpad semantic tone mapping.
- sidebar/topbar/mobile semantic chrome.
- quick action palette tone usage.
- mobile metric semantic state mapping.

## Known Carryover

This round intentionally did not rewrite every feature page or every raw Tailwind arbitrary color in the repository. Remaining work belongs to later UX/workflow rounds:

- Round 3: information architecture and navigation workflows.
- Round 4: Xray customer node cockpit.
- Round 8/9: subscription and portal experience.
- Round 10: forwarding/tunnel operations experience.

The new token layer should be used by those rounds before adding page-specific styling.

## Non-goals

- No logo or brand asset replacement.
- No claim that UI-only Preview capabilities are production-ready.
- No broad framework replacement.
- No runtime behavior changes beyond style and visual-state wiring.
