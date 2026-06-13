---
name: OU-UI Next
description: Production control plane UI for Universal Agent operations, forwarding, subscriptions, quotas, audit evidence, and release verification.
colors:
  primary: "#1E3AFF"
  primary-soft: "#DCE1FF"
  accent: "#FF3D18"
  accent-soft: "#FFD8C6"
  neutral-bg: "#FDFFF1"
  neutral-surface: "#FFFDF5"
  neutral-surface-muted: "#EAF3D1"
  neutral-border: "#07111F"
  text-strong: "#07111F"
  text-muted: "#35405A"
  success: "#00A878"
  warning: "#D9FF00"
  danger: "#DC2626"
  dark-bg: "#07111F"
  dark-surface: "#101827"
  dark-surface-muted: "#192238"
typography:
  display:
    fontFamily: "Cabinet Grotesk, Satoshi, Outfit, Geist, Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "3rem"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Cabinet Grotesk, Satoshi, Outfit, Geist, Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "2rem"
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Cabinet Grotesk, Satoshi, Outfit, Geist, Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Cabinet Grotesk, Satoshi, Outfit, Geist, Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 450
    lineHeight: 1.55
    letterSpacing: "0"
  label:
    fontFamily: "Cabinet Grotesk, Satoshi, Outfit, Geist, Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.01em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0"
rounded:
  xs: "0px"
  sm: "0px"
  md: "0px"
  lg: "0px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
    rounded: "{rounded.pill}"
    padding: "12px 18px"
  button-primary-hover:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
    rounded: "{rounded.pill}"
    padding: "12px 18px"
  button-secondary:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.text-strong}"
    rounded: "{rounded.pill}"
    padding: "12px 18px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.pill}"
    padding: "12px 14px"
  panel:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.text-strong}"
    rounded: "{rounded.md}"
    padding: "16px"
  surface-muted:
    backgroundColor: "{colors.neutral-surface-muted}"
    textColor: "{colors.text-strong}"
    rounded: "{rounded.sm}"
    padding: "12px"
  input-default:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.text-strong}"
    rounded: "{rounded.sm}"
    padding: "12px 14px"
  select-default:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.text-strong}"
    rounded: "{rounded.sm}"
    padding: "12px 14px"
  toggle-default:
    backgroundColor: "{colors.neutral-border}"
    textColor: "{colors.primary}"
    rounded: "{rounded.pill}"
    padding: "0px"
---

# Design System: OU-UI Next

## Overview

**Creative North Star: "The Operations Deck"**

This system is a calm, high-confidence control plane for real operational work. It should feel like a mission console: dense enough for expert users, quiet enough to scan, and disciplined enough that every page still reads as one product even when the workflows differ.

The visual language is a light-first Fauvist control plane: electric blue operating focus, raw vermilion execution accents, acid chartreuse verification signals, jungle green health states, hard compartment lines, and dense operational surfaces. Depth comes from structure, borders, density, decisive color fields, and restrained state motion instead of glass, glow, or soft SaaS tinting.

It explicitly rejects generic admin-template rhythm, marketing-page theatrics, cream-and-brass nostalgia, and any styling that hides the actual control surface behind ornament. `ou-*` is the canonical surface vocabulary; `Glass*` remains only as a compatibility shell.

Key characteristics:
- Light-first, with dark mode retained as a secondary system
- Operational density with clear hierarchy
- Motion that explains transitions and status changes
- Electric blue for primary actions, focus, active navigation, and control flow
- Raw vermilion, acid chartreuse, and jungle green for execution, verification, and health categories
- Dark ink, cool off-white, and hard borders for normal work surfaces
- Strong task, audit, and evidence legibility

## Colors

The palette is saturated but disciplined. It follows a Fauvist operational direction for light mode and a matching tactical dark expression for night work. Color is not decorative noise: electric blue owns interaction and wayfinding, raw vermilion marks execution boundaries, acid chartreuse marks verification and warning, jungle green marks health and online states, and red stays reserved for danger.

### Primary
- **Electric Blue Command** (`#1E3AFF`): primary actions, focus rings, active navigation, and topology flow.
- **Electric Blue Wash** (`#DCE1FF`): low-intensity selected fills, focus backgrounds, and control grouping.

### Accent
- **Raw Vermilion Execute** (`#FF3D18`): execution boundaries, launch surfaces, and high-attention secondary action.
- **Acid Chartreuse Verify** (`#D9FF00`): warning, review, release verification, and preflight emphasis.
- **Jungle Green Runtime** (`#00A878`): online, healthy, and live-agent status.

### Neutral
- **Acid Field** (`#FDFFF1`): app background and shell canvas.
- **Bone Plate** (`#FFFDF5`): main panels and modal surfaces.
- **Greenish Muted Field** (`#EAF3D1`): secondary panels and grouped areas.
- **Ink Line** (`#07111F`): separators, input borders, and panel edges through alpha tokens.
- **Strong Ink** (`#07111F`): primary text and labels.
- **Muted Ink** (`#35405A`): secondary text and helper copy.

### Semantic
- **Jungle Green Runtime** (`#00A878`): online, healthy, and completed states.
- **Acid Chartreuse Verify** (`#D9FF00`): caution, degraded, review, and partial-failure states.
- **Danger Red** (`#DC2626`): destructive, invalid, and blocked states.

### Dark Mode
- **Deep Console** (`#07111F`): overall dark background.
- **Console Surface** (`#101827`): elevated dark panels.
- **Console Muted** (`#192238`): secondary dark surface layers.

### Named Rules
**The Fauvist Signal Rule.** Electric blue is the only default action color. Raw vermilion, acid chartreuse, and jungle green must map to execution, verification/warning, and runtime health. Red is reserved for destructive or blocked states and must not become the brand accent again.

## Typography

**Display Font:** Cabinet Grotesk, Satoshi, Outfit, Geist, Inter, system fallbacks
**Body Font:** Cabinet Grotesk, Satoshi, Outfit, Geist, Inter, system fallbacks
**Label / Mono Font:** ui-monospace stack for status labels, IDs, timestamps, and code-like evidence

The typography should feel technical and composed, not decorative. Use the same family across the interface with weight, size, and spacing doing the hierarchy work.

### Hierarchy
- **Display** (700, 3rem, 1.05): reserved for page heroes and major surface titles.
- **Headline** (650, 2rem, 1.1): section headings and major workspace labels.
- **Title** (600, 1.5rem, 1.15): panel headers and object names.
- **Body** (450, 1rem, 1.55): main copy and instructions, with a 65-75ch comfort range for prose.
- **Label** (600, 0.8125rem, 0.01em): control labels, table headers, and short status text.
- **Mono** (600, 0.8125rem, 1.4): IDs, audit hashes, timings, and evidence details.

### Named Rules
**The No-Flair Labels Rule.** Labels stay legible and compact; the personality belongs in hierarchy and motion, not in decorative text treatment.

## Elevation

Depth is structural, not decorative. Surfaces rely on hard borders, plate contrast, and sparse shadows for major overlays. Blur exists only as a compatibility layer and should not read as glassmorphism.

### Shadow Vocabulary
- **Shell Shadow**: `0 22px 64px -42px rgba(5, 5, 5, 0.18), 0 6px 16px -12px rgba(5, 5, 5, 0.06)` for the app shell and major frames.
- **Card Shadow**: `0 14px 38px -30px rgba(5, 5, 5, 0.18)` for content cards.
- **Strong Shadow**: `0 28px 84px -50px rgba(5, 5, 5, 0.24)` for drawers, modals, and focused panels.
- **Dark Shell Shadow**: `0 30px 96px -54px rgba(0, 0, 0, 0.9)` for the dark theme.

### Named Rules
**The Surface-First Rule.** A panel should read as a control surface before it reads as a decoration. If a shadow does not clarify hierarchy, remove it.

## Components

### Buttons
Primary buttons are pill-shaped, decisive, and compact. They use the red fill, white text, and a crisp pressed state. Secondary buttons stay neutral and clear, while ghost buttons are quiet and subordinate.
- **Shape:** pill (`999px`) for action buttons; operating plates and cards stay square.
- **Primary:** electric-blue-to-vermilion fill, white text, 12px x 18px padding.
- **Hover / Active:** slight lift on hover, 1px press on active, no bounce.
- **Disabled:** reduced opacity and no elevation shift.

### Cards / Containers
Cards are content-bearing shells, not decorative wrappers. Use them when a block needs separation or hierarchy, and keep borders visible, radii square, and shadows sparse.
- **Corner Style:** square operating plates by default; pills are reserved for compact controls.
- **Background:** plate white over the light shell, darker plate surfaces in dark mode.
- **Padding:** 12px to 16px internally, with denser sections allowed for data tables.
- **Border:** 1px slate border or equivalent token-driven separator.

### Inputs / Fields
Inputs are plain, readable, and easy to scan. Labels sit above the field, helper text sits below it, and focus uses the electric-blue ring instead of a custom gimmick.
- **Style:** white or muted surface, square corners, 1px border.
- **Focus:** electric-blue border shift plus visible focus ring.
- **Error / Disabled:** red treatment for errors, softened opacity for disabled fields.

### Selects / Toggles
Selects and toggles are compact, familiar controls. They should never feel custom for the sake of novelty.
- **Selects:** neutral surface, clear dropdown affordance, strong selected text.
- **Toggles:** pill track with a bright thumb, electric-blue state for on.

### Navigation
Large screens use sidebar and topbar together; small screens collapse to a bottom nav. Active state should be obvious, but not loud.
- **Active:** electric-blue/plate fill with clear text weight; vermilion only for execution boundaries.
- **Hover:** gentle color shift and lift.
- **Mobile:** icon plus label, no icon-only navigation.

### Drawers / Modals
Drawers and modals are the strongest surfaces in the system. They should open with spatial continuity, preserve focus, and remain calm enough to use for real work.
- **Motion:** soft slide or scale plus fade.
- **Structure:** sticky header, scrollable body, steady footer actions.

### Shell / Backdrop
The shell uses a hard grid, angular electric-blue/vermilion/chartreuse fields, and a faint operational ribbon. These are environmental cues, not decoration.

## Do's and Don'ts

### Do:
- **Do** keep the product light-first by default, with dark mode as a secondary expression.
- **Do** use electric blue for default control focus, active navigation, and primary actions.
- **Do** use vermilion, chartreuse, and green only when they clarify execution, verification/warning, or runtime health.
- **Do** use cool off-white, dark ink, and borders for normal hierarchy.
- **Do** keep motion tied to status changes, surface transitions, and feedback.
- **Do** use `ou-*` classes and compatibility wrappers consistently.
- **Do** preserve clear hierarchy for tasks, permissions, quotas, audits, and release evidence.

### Don't:
- **Don't** make purple or violet the dominant visual language.
- **Don't** use cream, sand, beige, or paper-yellow backgrounds as the default brand tone.
- **Don't** reintroduce the old `#2563EB` / `#F97316` SaaS blue-orange palette or make the product feel like a generic admin template.
- **Don't** let red-black industrial styling become the dominant palette again.
- **Don't** turn the app into a marketing hero page or a generic SaaS template.
- **Don't** use decorative glassmorphism everywhere or stack cards inside cards.
- **Don't** rely on color alone for state, or let long labels overflow their containers.
- **Don't** add motion that does not communicate state, hierarchy, or feedback.
- **Don't** change the meaning of operational terms to sound more clever or more polished.
