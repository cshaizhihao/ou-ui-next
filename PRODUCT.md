# Product

## Register
product

## Users
Operators, maintainers, and implementation engineers who manage the Master control plane in a browser while handling hosts, customer nodes, forwarding rules, subscription flows, quota policies, audit evidence, Telegram notifications, and production acceptance. They are usually under time pressure and need a dense but readable interface that makes state, ownership, and rollback boundaries obvious.

## Product Purpose
OU-UI Next is a production control plane for Universal Agent management, multi-host orchestration, customer node and forwarding operations, subscription distribution, quota enforcement, audit evidence, Telegram messaging, and release verification. Success means an operator can deploy, inspect, retry, revoke, or roll back a change without losing track of the task, the evidence, or the boundary between live operations and historical records.

## Brand Personality
Precise, authoritative, disciplined. The voice should feel calm under load, concrete in its wording, and confident without hype. It should read like a serious operational system that expects to be used every day.

## Anti-references
Generic admin templates, marketing landing pages, empty hero sections, purple neon glassmorphism, decorative gradients, ornamental motion, vague SaaS copy, and any UI that obscures task/audit/evidence boundaries. Avoid anything that makes the product feel like a demo shell instead of a real control plane.

## Design Principles
- Operational clarity first: users should always know what is active, what is pending, what is reversible, and what is evidence.
- Preserve business semantics: tasks, permissions, quotas, audit logs, and release flows must stay legible as distinct systems.
- Dense but legible: the UI can hold a lot of information, but it must still scan cleanly on desktop and remain usable on tablet and mobile.
- Motion must carry state: transitions should explain change, not decorate it.
- Consistency beats novelty: the same surfaces, labels, and interaction patterns should mean the same thing across the product.

## Accessibility & Inclusion
Target WCAG AA. Keyboard navigation, visible focus, semantic controls, reduced motion support, and 44px minimum touch targets are required. Loading, empty, success, and error states must be explicit. Color must never be the only way state is communicated, and long localized strings must wrap cleanly without overlap or truncation.
