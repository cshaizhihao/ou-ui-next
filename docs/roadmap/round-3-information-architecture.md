# Round 3 Information Architecture Rework

Round: 3 - information architecture and navigation  
Date: 2026-07-07  
Scope: desktop navigation, dashboard task paths, status center, command palette discovery, and production smoke selectors.

## Skill Inputs

This round used `ui-ux-pro-max` with the design-system search path, plus frontend-design implementation guidance.

The applicable UI/UX direction was:

- Operators need stable navigation hierarchy before more page-level features are added.
- Status evidence should be visible on the first screen, not hidden inside feature tables.
- Common work paths should be reachable in two to three actions.
- Command/search should expose objects, actions, and state destinations, not only page labels.
- Navigation labels must stay aligned with the actual runtime and feature surface.

## Implemented Decisions

### Navigation Hierarchy

The desktop sidebar now has three clear groups:

- `运行工作台` / `Operations`: overview, servers, customer nodes, forwarding, subscriptions.
- `客户与策略` / `Customers & Policy`: customers, routing, tuning, notifications.
- `证据与设置` / `Evidence & Settings`: execution records, audit, accounts.

`运行工作台` and `证据与设置` open by default, making runtime evidence and settings discoverable without hiding them behind a vague advanced group. Customer/policy tools remain grouped separately to reduce first-screen noise.

### Dashboard Task Paths

The operations launchpad now exposes six first-screen paths:

- enroll servers.
- deliver customer nodes.
- configure forwarding.
- generate subscriptions.
- review task evidence.
- open settings.

The launchpad still uses real snapshot counts only. It does not create new backend capabilities or claim runtime support beyond existing pages.

### Status Center

A new dashboard status center summarizes real Control Plane state:

- online Agents.
- runtime apply tasks in `queued` / `running` / `retrying`.
- failed tasks.
- quota or policy-risk Xray clients.

Each status item routes to the existing workspace that can inspect the evidence or resource. The counts are derived from the current snapshot, not static demo data.

### Command Palette Discovery

Global quick actions now include state-oriented entries:

- status center.
- failed tasks.
- quota risk.
- Runtime Apply.
- accounts and settings.

This makes the command palette a way to reach current operational state, not just a page switcher and object finder.

### Smoke Alignment

The production browser smoke script now recognizes the new navigation labels while retaining the older advanced-group labels for compatibility.

## Tests Guarding This Round

Updated tests protect:

- the three-group navigation model in Chinese and English.
- visible task evidence and settings paths on the dashboard launchpad.
- the dashboard status center and its routing behavior.
- sidebar default discoverability for operations and evidence/settings.
- App/AppShell behavior after the new navigation defaults.
- production browser smoke selector compatibility.

## Non-goals

- No Xray runtime behavior was changed in this round.
- No subscription output behavior was changed in this round.
- No forwarding/tunnel runtime behavior was changed in this round.
- No logo or brand assets were changed.
- No Preview/Roadmap ability was promoted to implemented.

## Carryover

- Round 4 should convert the customer-node page into a real Xray cockpit using the new IA and status patterns.
- Round 5/6 should continue proving multi-client inbound and Agent apply/evidence workflows with real Agent smoke.
- Round 8/9 should use the same status-center style for subscription delivery and source diagnosis.
- Round 10 should turn forwarding into a stateful operations workspace rather than a form-first page.
