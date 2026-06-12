---
name: OU-UI Next
description: Production control plane UI for Universal Agent operations, forwarding, subscriptions, quotas, audit evidence, and release verification.
colors:
  primary: "#2563EB"
  primary-soft: "#DBEAFE"
  accent: "#F97316"
  accent-soft: "#FFEDD5"
  neutral-bg: "#F8FAFC"
  neutral-surface: "#FFFFFF"
  neutral-surface-muted: "#F1F5F9"
  neutral-border: "#E2E8F0"
  text-strong: "#0F172A"
  text-muted: "#475569"
  success: "#059669"
  warning: "#D97706"
  danger: "#DC2626"
  dark-bg: "#07111F"
  dark-surface: "#0B1323"
  dark-surface-muted: "#0F172A"
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
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
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

The visual language is light-first and cold-toned: white, slate, blue, and a controlled orange accent. Depth comes from layered surfaces, subtle blur, tinted shadows, and restrained motion tied to state changes. The interface should feel premium and authoritative without tipping into decorative glass or AI-purple spectacle.

It explicitly rejects generic admin-template rhythm, marketing-page theatrics, cream-and-brass nostalgia, and any styling that hides the actual control surface behind ornament. `ou-*` is the canonical surface vocabulary; `Glass*` remains only as a compatibility shell.

Key characteristics:
- Light-first, with dark mode retained as a secondary system
- Operational density with clear hierarchy
- Motion that explains transitions and status changes
- Blue for primary control, orange for emphasis and warnings
- Strong task, audit, and evidence legibility

## Colors

The palette is restrained and technical, with blue as the main control color and orange reserved for emphasis, alerts, and high-signal highlights.

### Primary
- **Control Blue** (`#2563EB`): primary actions, active navigation, selected states, and key progress indicators.
- **Soft Blue** (`#DBEAFE`): subtle active fills, active backgrounds, and low-intensity emphasis.

### Accent
- **Signal Orange** (`#F97316`): secondary emphasis, warnings, noteworthy events, and selective highlight moments.
- **Soft Orange** (`#FFEDD5`): background tint for caution or emphasis blocks.

### Neutral
- **Control White** (`#FFFFFF`): main panels and modal surfaces.
- **Slate Mist** (`#F8FAFC`): app background and shell canvas.
- **Muted Surface** (`#F1F5F9`): secondary panels, skeleton bases, and subtle grouped areas.
- **Hairline Border** (`#E2E8F0`): separators, input borders, and panel edges.
- **Strong Ink** (`#0F172A`): primary text and labels.
- **Muted Ink** (`#475569`): secondary text and helper copy.

### Semantic
- **Success Green** (`#059669`): online, healthy, and completed states.
- **Warning Amber** (`#D97706`): caution, degraded, and partial-failure states.
- **Danger Red** (`#DC2626`): destructive, invalid, and blocked states.

### Dark Mode
- **Night Base** (`#07111F`): overall dark background.
- **Night Surface** (`#0B1323`): elevated dark panels.
- **Night Muted** (`#0F172A`): secondary dark surface layers.

### Named Rules
**The One Accent Rule.** Blue carries the product; orange only appears where it earns its signal.

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

Depth is structural, not decorative. Surfaces use a hybrid system: light blur and tinted shadows for shells, softer cards for content groupings, and stronger elevation only for drawers, modals, and command surfaces.

### Shadow Vocabulary
- **Shell Shadow**: `0 24px 72px -46px rgba(15, 23, 42, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.72)` for the app shell and major frames.
- **Card Shadow**: `0 14px 38px -30px rgba(15, 23, 42, 0.18)` for content cards.
- **Strong Shadow**: `0 22px 64px -38px rgba(15, 23, 42, 0.2)` for drawers, modals, and focused panels.
- **Dark Shell Shadow**: `0 30px 96px -54px rgba(2, 6, 23, 0.9)` for the dark theme.

### Named Rules
**The Surface-First Rule.** A panel should read as a control surface before it reads as a decoration. If a shadow does not clarify hierarchy, remove it.

## Components

### Buttons
Primary buttons are pill-shaped, decisive, and compact. They use the blue fill, white text, and a crisp pressed state. Secondary buttons stay neutral and clear, while ghost buttons are quiet and subordinate.
- **Shape:** pill (`999px`) for action buttons; tighter radii only for compact utilities.
- **Primary:** blue fill, white text, 12px x 18px padding.
- **Hover / Active:** slight lift on hover, 1px press on active, no bounce.
- **Disabled:** reduced opacity and no elevation shift.

### Cards / Containers
Cards are content-bearing shells, not decorative wrappers. Use them when a block needs separation or hierarchy, and keep the borders thin, the shadows tinted, and the radius consistent.
- **Corner Style:** 12px to 20px depending on shell depth.
- **Background:** white or translucent white over the light shell, darker translucent surfaces in dark mode.
- **Padding:** 12px to 16px internally, with denser sections allowed for data tables.
- **Border:** 1px slate border or equivalent token-driven separator.

### Inputs / Fields
Inputs are plain, readable, and easy to scan. Labels sit above the field, helper text sits below it, and focus uses a blue ring instead of a custom gimmick.
- **Style:** white or muted surface, 12px radius, 1px border.
- **Focus:** blue border shift plus visible focus ring.
- **Error / Disabled:** red treatment for errors, softened opacity for disabled fields.

### Selects / Toggles
Selects and toggles are compact, familiar controls. They should never feel custom for the sake of novelty.
- **Selects:** neutral surface, clear dropdown affordance, strong selected text.
- **Toggles:** pill track with a bright thumb, blue state for on.

### Navigation
Large screens use sidebar and topbar together; small screens collapse to a bottom nav. Active state should be obvious, but not loud.
- **Active:** blue accent and subtle surface fill.
- **Hover:** gentle color shift and lift.
- **Mobile:** icon plus label, no icon-only navigation.

### Drawers / Modals
Drawers and modals are the strongest surfaces in the system. They should open with spatial continuity, preserve focus, and remain calm enough to use for real work.
- **Motion:** soft slide or scale plus fade.
- **Structure:** sticky header, scrollable body, steady footer actions.

### Shell / Backdrop
The shell uses a light grid, subtle ambient blue and orange glows, and a faint operational ribbon. These are environmental cues, not decoration.

## Do's and Don'ts

### Do:
- **Do** keep the product light-first by default, with dark mode as a secondary expression.
- **Do** use blue for primary actions, active states, and selection.
- **Do** use orange sparingly for emphasis, warnings, and signal moments.
- **Do** keep motion tied to status changes, surface transitions, and feedback.
- **Do** use `ou-*` classes and compatibility wrappers consistently.
- **Do** preserve clear hierarchy for tasks, permissions, quotas, audits, and release evidence.

### Don't:
- **Don't** make purple or violet the dominant visual language.
- **Don't** use cream, sand, beige, or paper-yellow backgrounds as the default brand tone.
- **Don't** turn the app into a marketing hero page or a generic SaaS template.
- **Don't** use decorative glassmorphism everywhere or stack cards inside cards.
- **Don't** rely on color alone for state, or let long labels overflow their containers.
- **Don't** add motion that does not communicate state, hierarchy, or feedback.
- **Don't** change the meaning of operational terms to sound more clever or more polished.
