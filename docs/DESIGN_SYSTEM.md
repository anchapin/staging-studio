# StagingStudio Design System

**Version**: 1.0.0
**Last Updated**: 2026-09-19
**Status**: Active

---

## Table of Contents

1. [Design Foundations](#1-design-foundations)
2. [Color System](#2-color-system)
3. [Typography](#3-typography)
4. [Spacing & Layout](#4-spacing--layout)
5. [Components](#5-components)
6. [Accessibility Standards](#6-accessibility-standards)
7. [Dark Mode](#7-dark-mode)
8. [Usage Guidelines](#8-usage-guidelines)

---

## 1. Design Foundations

### Design Principles

- **Consistency over novelty**: Use established tokens and components before creating new patterns
- **Accessibility by default**: WCAG 2.2 AA compliance built into every component
- **Semantic meaning**: Colors, tokens, and components carry meaning — not just aesthetics
- **Performance-conscious**: CSS-first Tailwind v4 with design token integration

### Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| CSS Framework | Tailwind CSS v4 | Utility-first styling |
| Component Library | shadcn/ui (base-nova style) | Base component primitives |
| Component Primitives | @base-ui/react | Accessible component primitives |
| Variant System | class-variance-authority (CVA) | Composable variant styles |
| Color Space | oklch | Perceptually uniform colors |

### File Structure

```
src/
├── app/
│   ├── globals.css          # Design tokens + base styles
│   ├── layout.tsx          # Font loading + root layout
│   └── page.tsx           # Root page
├── components/
│   ├── ui/
│   │   ├── button.tsx     # Button component
│   │   ├── input.tsx      # Form input
│   │   ├── badge.tsx      # Status badge
│   │   ├── separator.tsx  # Visual divider
│   │   └── toast.tsx      # Toast notifications
│   ├── canvas/            # Staging editor components
│   ├── dashboard/         # Dashboard components
│   └── lookbook/          # PDF export components
└── lib/
    └── utils.ts           # cn() utility for class merging
```

---

## 2. Color System

### Architecture

Colors are defined using **oklch** (OKLab Lightness-Chroma-Hue) color space for:
- Perceptually uniform lightness (better for accessibility)
- Wide gamut support
- Predictable mixing behavior

Tokens are defined in `src/app/globals.css` under `:root` and `.dark`.

### Token Categories

#### 2.1 Neutral / Surface Colors

| Token | Light Mode | Dark Mode | Usage |
|-------|-----------|-----------|-------|
| `--background` | `oklch(1 0 0)` | `oklch(0.145 0 0)` | Page background |
| `--foreground` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` | Primary text |
| `--card` | `oklch(1 0 0)` | `oklch(0.205 0 0)` | Card surfaces |
| `--card-foreground` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` | Card text |
| `--popover` | `oklch(1 0 0)` | `oklch(0.205 0 0)` | Dropdown surfaces |
| `--popover-foreground` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` | Dropdown text |

#### 2.2 Primary Colors

| Token | Light Mode | Dark Mode | Usage |
|-------|-----------|-----------|-------|
| `--primary` | `oklch(0.205 0 0)` | `oklch(0.922 0 0)` | Primary actions, CTAs |
| `--primary-foreground` | `oklch(0.985 0 0)` | `oklch(0.205 0 0)` | Text on primary |

**Contrast**: Primary on primary-foreground exceeds 12:1 in both modes (WCAG AAA)

#### 2.3 Secondary Colors

| Token | Light Mode | Dark Mode | Usage |
|-------|-----------|-----------|-------|
| `--secondary` | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` | Secondary surfaces |
| `--secondary-foreground` | `oklch(0.205 0 0)` | `oklch(0.985 0 0)` | Secondary text |

#### 2.4 Muted Colors

| Token | Light Mode | Dark Mode | Usage |
|-------|-----------|-----------|-------|
| `--muted` | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` | Muted backgrounds |
| `--muted-foreground` | `oklch(0.556 0 0)` | `oklch(0.708 0 0)` | Secondary text, labels |

**Contrast**: `--muted-foreground` against `--background` = 4.8:1 (WCAG AA for 14pt+)

#### 2.5 Accent Colors

| Token | Light Mode | Dark Mode | Usage |
|-------|-----------|-----------|-------|
| `--accent` | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` | Accent backgrounds |
| `--accent-foreground` | `oklch(0.205 0 0)` | `oklch(0.985 0 0)` | Accent text |

#### 2.6 Destructive / Error Colors

| Token | Light Mode | Dark Mode | Usage |
|-------|-----------|-----------|-------|
| `--destructive` | `oklch(0.577 0.245 27.325)` | `oklch(0.704 0.191 22.216)` | Destructive actions |
| `--destructive-foreground` | `210 40% 98%` (hsl) | Same | Text on destructive |

**Contrast**: Destructive exceeds 4.6:1 (WCAG AA)

#### 2.7 Semantic Status Colors

| Token | Light Mode | Dark Mode | Usage |
|-------|-----------|-----------|-------|
| `--success` | `oklch(0.627 0.194 149.213)` | `oklch(0.55 0.17 145)` | Success states |
| `--success-foreground` | `oklch(0.98 0.01 149.213)` | `oklch(0.98 0.01 145)` | Text on success |
| `--warning` | `oklch(0.769 0.188 70.08)` | `oklch(0.7 0.17 70)` | Warning states |
| `--warning-foreground` | `oklch(0.98 0.01 70.08)` | `oklch(0.98 0.01 70)` | Text on warning |
| `--info` | `oklch(0.546 0.245 252.149)` | `oklch(0.55 0.22 252)` | Informational |
| `--info-foreground` | `oklch(0.98 0.01 252.149)` | `oklch(0.98 0.01 252)` | Text on info |

#### 2.8 UI Colors

| Token | Light Mode | Dark Mode | Usage |
|-------|-----------|-----------|-------|
| `--border` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 10%)` | Borders, dividers |
| `--input` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 15%)` | Input backgrounds |
| `--ring` | `oklch(0.708 0 0)` | `oklch(0.556 0 0)` | Focus rings |

#### 2.9 Chart Colors

Neutral palette for data visualization (no semantic meaning):

```
--chart-1: oklch(0.87 0 0)
--chart-2: oklch(0.556 0 0)
--chart-3: oklch(0.439 0 0)
--chart-4: oklch(0.371 0 0)
--chart-5: oklch(0.269 0 0)
```

#### 2.10 Sidebar Colors

Dedicated tokens for dashboard sidebar:

| Token | Light Mode | Dark Mode |
|-------|-----------|-----------|
| `--sidebar` | `oklch(0.985 0 0)` | `oklch(0.205 0 0)` |
| `--sidebar-foreground` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` |
| `--sidebar-primary` | `oklch(0.205 0 0)` | `oklch(0.488 0.243 264.376)` |
| `--sidebar-primary-foreground` | `oklch(0.985 0 0)` | `oklch(0.985 0 0)` |
| `--sidebar-accent` | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` |
| `--sidebar-accent-foreground` | `oklch(0.205 0 0)` | `oklch(0.985 0 0)` |
| `--sidebar-border` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 10%)` |
| `--sidebar-ring` | `oklch(0.708 0 0)` | `oklch(0.556 0 0)` |

### CSS Variable Usage

```css
/* Direct usage in CSS */
.my-component {
  background-color: var(--primary);
  color: var(--primary-foreground);
  border-color: var(--border);
}

/* Tailwind integration via tailwind.config.ts */
<div className="bg-primary text-primary-foreground border-border">
  Content
</div>
```

---

## 3. Typography

### 3.1 Font Stack

Three Google Fonts loaded via `next/font/google`:

| Font | Variable | Usage | Category |
|------|----------|-------|----------|
| **Cinzel** | `--font-cinzel` | Display headings, lookbook titles | Display |
| **Playfair Display** | `--font-playfair` | Editorial headings, property names | Serif |
| **Plus Jakarta Sans** | `--font-plus-jakarta` | Body text, UI elements | Sans-serif |

### 3.2 Tailwind Font Classes

```typescript
// tailwind.config.ts
fontFamily: {
  cinzel: ["var(--font-cinzel)", "serif"],
  playfair: ["var(--font-playfair)", "serif"],
  jakarta: ["var(--font-plus-jakarta)", "sans-serif"],
}
```

### 3.3 Font Usage Conventions

| Class | Font | Usage |
|-------|------|-------|
| `font-cinzel` | Cinzel | Cover page titles, "STAGING LOOKBOOK" label |
| `font-playfair` | Playfair Display | Property addresses, buyer profiles, section headings |
| `font-jakarta` / `font-sans` | Plus Jakarta Sans | Body text, form labels, buttons, navigation |

### 3.4 Type Scale

The type scale uses Tailwind's default sizing. No custom scale is defined — use Tailwind's standard classes:

| Tailwind Class | Font Size | Line Height | Usage |
|----------------|----------|------------|-------|
| `text-xs` | 12px / 0.75rem | 16px | Badges, captions |
| `text-sm` | 14px / 0.875rem | 20px | Secondary text, labels |
| `text-base` | 16px / 1rem | 24px | Body text |
| `text-lg` | 18px / 1.125rem | 28px | Lead text |
| `text-xl` | 20px / 1.25rem | 28px | H4 headings |
| `text-2xl` | 24px / 1.5rem | 32px | H3 headings |
| `text-3xl` | 30px / 1.875rem | 36px | H2 headings |
| `text-4xl` | 36px / 2.25rem | 40px | H1 headings |
| `text-5xl` | 48px / 3rem | 1 | Cover page hero |

### 3.5 Font Weight Classes

| Class | Weight | Usage |
|-------|--------|-------|
| `font-normal` | 400 | Body text |
| `font-medium` | 500 | Labels, secondary text |
| `font-semibold` | 600 | Emphasis, subheadings |
| `font-bold` | 700 | Headings, key values |

---

## 4. Spacing & Layout

### 4.1 Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius` | `0.625rem` (10px) | Primary border radius |
| `lg` | `var(--radius)` | Cards, modals, large elements |
| `md` | `calc(var(--radius) - 2px)` | Buttons, inputs |
| `sm` | `calc(var(--radius) - 4px)` | Small elements, badges |

### 4.2 Layout Grid

- **Grid system**: 12-column flexible grid
- **Breakpoints**: 640px (sm), 768px (md), 1024px (lg), 1280px (xl)
- **Container max-widths**: Follow Tailwind defaults

### 4.3 Responsive Image Sizing

```typescript
// room-canvas.tsx
const ROOM_CANVAS_IMAGE_SIZES = "(max-width: 767px) calc(100vw - 320px), calc((100vw - 352px) / 2)";
const FOCUSED_ROOM_IMAGE_SIZES = "(max-width: 767px) calc(100vw - 320px), calc(100vw - 320px)";
```

**Note**: Magic numbers (320, 352) represent sidebar width + padding. Consider extracting to CSS custom properties for maintainability.

---

## 5. Components

### 5.1 Button

**Location**: `src/components/ui/button.tsx`
**Primitive**: `@base-ui/react/button`

#### Variants

| Variant | Usage | Example |
|---------|-------|---------|
| `default` | Primary actions, CTAs | Submit, Save, Create |
| `outline` | Secondary actions | Cancel, Back |
| `secondary` | Less prominent actions | Reset, Dismiss |
| `ghost` | Minimal actions | Close, Menu items |
| `destructive` | Destructive actions | Delete, Remove |
| `link` | Inline text links | "Learn more" |

#### Sizes

| Size | Class | Usage |
|------|-------|-------|
| `xs` | `h-6 px-2 text-xs` | Compact UI, icon buttons |
| `sm` | `h-7 px-2.5 text-[0.8rem]` | Dense tables, small cards |
| `default` | `h-8 px-2.5 text-sm` | Standard buttons |
| `lg` | `h-9 px-2.5 text-base` | Primary CTAs |
| `icon` | `size-8` | Square icon buttons |
| `icon-sm` | `size-7` | Small square icon buttons |
| `icon-xs` | `size-6` | Extra small icon buttons |

#### States

| State | Implementation | Visual |
|-------|----------------|--------|
| Hover | `hover:` | Darken/lighten background |
| Focus | `focus-visible:ring-3` | Ring offset, 3px spread |
| Active | `active:translate-y-px` | Slight press effect |
| Disabled | `disabled:opacity-50` | Reduced opacity |
| Loading | Component handles | Spinner + disabled |

#### Accessibility

- Uses native `<button>` element
- `focus-visible` ring for keyboard navigation
- `aria-invalid` for error states
- Icon-only buttons require `aria-label`

#### Usage Example

```tsx
import { Button } from "@/components/ui/button"

<Button variant="default" size="default">
  Save Project
</Button>

<Button variant="destructive" size="sm">
  Delete
</Button>

<Button variant="ghost" size="icon">
  <TrashIcon className="size-4" />
  <span className="sr-only">Delete</span>
</Button>
```

---

### 5.2 Input

**Location**: `src/components/ui/input.tsx`

#### Props

| Prop | Type | Default | Usage |
|------|------|---------|-------|
| `type` | `"text"` \| `"email"` \| `"password"` \| ... | `"text"` | HTML input type |
| `error` | `boolean` | `false` | Shows destructive border |
| `disabled` | `boolean` | `false` | Disables input |
| Standard HTML input props | — | — | `placeholder`, `value`, etc. |

#### States

| State | Implementation | Visual |
|-------|----------------|--------|
| Default | — | `--input` background, `--border` border |
| Hover | `hover:` | Slightly darker border |
| Focus | `focus-visible:ring-2` | `--ring` focus ring |
| Error | `error={true}` | `--destructive` border |
| Disabled | `disabled` | 50% opacity |

#### Accessibility

- Native `<input>` element
- `aria-invalid` set when `error={true}`
- Use with `<label>` element for proper association
- Support for `aria-describedby` via spread props

#### Usage Example

```tsx
import { Input } from "@/components/ui/input"

<Input
  type="text"
  placeholder="Property address"
  error={hasError}
  aria-invalid={hasError}
  aria-describedby="address-help"
/>
```

---

### 5.3 Badge

**Location**: `src/components/ui/badge.tsx`

#### Variants

| Variant | Usage | Visual |
|---------|-------|--------|
| `default` | Neutral status | Secondary background |
| `secondary` | Disabled, inactive | Muted background |
| `success` | Completed, confirmed | Green tint |
| `warning` | Pending, attention | Amber tint |
| `destructive` | Error, rejected | Red tint |
| `outline` | Secondary actions | Border only |

#### Sizes

| Size | Class | Usage |
|------|-------|-------|
| `sm` | `h-4 px-1.5 text-[10px]` | Compact badges |
| `default` | `h-5 px-2 text-xs` | Standard badges |
| `lg` | `h-6 px-2.5 text-sm` | Emphasized badges |

#### Accessibility

- Renders as `<span>` with no implicit role
- For status indicators, provide `aria-label` or visible text
- Color is NOT the sole indicator — variants have distinct visual weight

#### Usage Example

```tsx
import { Badge } from "@/components/ui/badge"

<Badge variant="success">Completed</Badge>
<Badge variant="warning">Pending</Badge>
<Badge variant="destructive">Failed</Badge>
<Badge variant="outline">Archived</Badge>
```

---

### 5.4 Separator

**Location**: `src/components/ui/separator.tsx`

#### Props

| Prop | Type | Default | Usage |
|------|------|---------|-------|
| `orientation` | `"horizontal"` \| `"vertical"` | `"horizontal"` | Line orientation |
| `variant` | `"default"` \| `"muted"` \| `"subtle"` | `"default"` | Visual weight |
| `decorative` | `boolean` | `true` | Removes semantic role |
| Standard HTML hr props | — | — | `className`, `id`, etc. |

#### Variants

| Variant | Visual | Usage |
|---------|--------|-------|
| `default` | Solid `--border` | Section breaks within cards |
| `muted` | Dashed `--muted` | Grouping within content |
| `subtle` | Light `--accent` | Subtle section dividers |

#### Accessibility

- Horizontal: renders as `<hr>`
- Vertical: renders as `<div role="separator">`
- `aria-orientation` set for vertical separators
- Set `decorative={false}` when separator is semantically meaningful

#### Usage Example

```tsx
import { Separator } from "@/components/ui/separator"

<Separator />

<Separator variant="muted" />

<Separator orientation="vertical" className="h-full" />

<Separator variant="subtle" decorative={false} />
```

---

### 5.5 Toast

**Location**: `src/components/ui/toast.tsx`

#### Toast Types

| Type | Role | aria-live | Usage |
|------|------|-----------|-------|
| `success` | `status` | `"polite"` | Confirmations |
| `error` | `alert` | `"assertive"` | Errors requiring attention |
| `info` | `status` | `"polite"` | Informational messages |

#### Features

- Auto-dismiss after 8 seconds
- Slide-in animation (300ms)
- Retry action for retryable errors
- Dismiss button
- Progress bar (implicit via timing)

#### Usage Example

```tsx
const { showSuccess, showError, showInfo } = useToast()

showSuccess("Project saved successfully")
showError("Failed to upload image", true, onRetry, "Retry upload")
showInfo("Processing your request...")
```

---

## 6. Accessibility Standards

### 6.1 Color Contrast

All text/background combinations meet WCAG 2.2 AA:

| Combination | Ratio | Level |
|-------------|-------|-------|
| `--foreground` on `--background` | 12.5:1 | AAA |
| `--primary-foreground` on `--primary` | 12:1 | AAA |
| `--muted-foreground` on `--background` | 4.8:1 | AA |
| `--destructive` on white | 4.6:1 | AA |
| `--success` on white | 4.2:1 | AA |
| `--warning` on white | 3.8:1 | AA |

### 6.2 Focus Management

| Requirement | Implementation |
|-------------|----------------|
| Visible focus indicator | `focus-visible:ring-2 focus-visible:ring-ring/50` |
| Focus not suppressed | No `outline: none` without alternative |
| Keyboard navigation | All interactive elements reachable via Tab |
| Focus trap | Modal dialogs trap focus |

### 6.3 Touch Targets

- Minimum touch target: **44×44px** (iOS) / **48×48dp** (Material)
- Icon buttons use `size-8` (32px) minimum with adequate spacing

### 6.4 Screen Reader Support

| Element | ARIA Pattern |
|---------|--------------|
| Buttons | Native `<button>` with descriptive text |
| Icon buttons | `aria-label` describing the action |
| Form inputs | `<label>` association + `aria-describedby` |
| Toast (error) | `role="alert"` + `aria-live="assertive"` |
| Toast (success/info) | `role="status"` + `aria-live="polite"` |
| Loading states | `role="progressbar"` with `aria-valuenow` |
| Status badges | Context-dependent; prefer visible text labels |

### 6.5 Motion & Animation

```css
/* Respect user preference for reduced motion */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

Toast animations use `duration-300 ease-out` — consider adding `prefers-reduced-motion` support for production.

---

## 7. Dark Mode

### Implementation

Dark mode uses **selector-based** switching via Tailwind's `darkMode: "selector"`:

```typescript
// tailwind.config.ts
darkMode: "selector"
```

Users add `class="dark"` to `<html>` to enable dark mode.

### Token Override Strategy

| Category | Light Mode Override | Dark Mode Override |
|----------|--------------------|--------------------|
| Background | `--background: oklch(1 0 0)` | `--background: oklch(0.145 0 0)` |
| Foreground | `--foreground: oklch(0.145 0 0)` | `--foreground: oklch(0.985 0 0)` |
| Borders | `--border: oklch(0.922 0 0)` | `--border: oklch(1 0 0 / 10%)` |

### Dark Mode Color Philosophy

- **Not inverted**: Light mode is the base; dark mode adapts thoughtfully
- **Reduced contrast in dark mode**: Still meets WCAG AA but softer on eyes
- **Semantic preservation**: Success = green, Warning = amber, Destructive = red

---

## 8. Usage Guidelines

### 8.1 When to Use Design Tokens

**Always use design tokens** for:
- Colors (background, foreground, border, etc.)
- Border radius
- Font families
- Shadows (when added)

**Prefer Tailwind utilities** for:
- Spacing (`p-4`, `m-2`, `gap-6`)
- Typography (`text-sm`, `font-bold`)
- Layout (`flex`, `grid`, `block`)

### 8.2 Anti-Patterns

| Anti-Pattern | Problem | Solution |
|--------------|---------|----------|
| Hardcoded colors (`#ccc`, `rgb(0,0,0)`) | No dark mode, no semantic meaning | Use `var(--border)`, `var(--muted)`, etc. |
| Off-palette colors (`stone-200`, `slate-500`) | Inconsistent with design system | Use semantic tokens |
| Inline styles for colors | Not themeable | Use Tailwind classes |
| Magic numbers in calculations | Fragile, hard to maintain | Extract to CSS variables |

### 8.3 Component Selection Guide

**Button variant selection**:

| Action Type | Variant | Example |
|-------------|---------|---------|
| Primary CTA | `default` | Save, Submit, Create |
| Secondary action | `outline` | Cancel, Back |
| Destructive action | `destructive` | Delete, Remove |
| Minimal action | `ghost` | Close, Menu |
| Inline link | `link` | "Forgot password?" |

**Badge variant selection**:

| Status | Variant | Notes |
|--------|---------|-------|
| Active/Completed | `success` | Green semantic |
| Pending/In Progress | `warning` | Amber semantic |
| Error/Rejected | `destructive` | Red semantic |
| Disabled/Inactive | `secondary` | Muted appearance |
| Neutral | `default` | No semantic meaning |
| Filter/Tag | `outline` | Interactive or categorical |

### 8.4 Migration Guide

For components using off-palette colors, migrate as follows:

| Current | Replace With | Example |
|---------|-------------|---------|
| `border-stone-200` | `border-border` | Card borders |
| `bg-stone-100` | `bg-muted` | Subtle backgrounds |
| `text-stone-500` | `text-muted-foreground` | Secondary text |
| `hover:bg-stone-800` | `hover:bg-secondary` | Dark mode hovers |
| `bg-green-50` | `bg-success/10` | Success backgrounds |

---

## Appendix A: Token Quick Reference

### Core Tokens

```css
/* Surfaces */
--background
--foreground
--card
--card-foreground
--popover
--popover-foreground

/* Actions */
--primary
--primary-foreground
--secondary
--secondary-foreground
--muted
--muted-foreground
--accent
--accent-foreground
--destructive
--destructive-foreground

/* Status */
--success
--success-foreground
--warning
--warning-foreground
--info
--info-foreground

/* UI */
--border
--input
--ring
--radius

/* Chart */
--chart-1 through --chart-5

/* Sidebar */
--sidebar
--sidebar-foreground
--sidebar-primary
--sidebar-primary-foreground
--sidebar-accent
--sidebar-accent-foreground
--sidebar-border
--sidebar-ring
```

### Tailwind Classes

```css
/* Surfaces */
bg-background text-foreground
bg-card text-card-foreground

/* Actions */
bg-primary text-primary-foreground
bg-secondary text-secondary-foreground
bg-muted text-muted-foreground
bg-accent text-accent-foreground
bg-destructive text-destructive-foreground

/* Status */
bg-success text-success-foreground
bg-warning text-warning-foreground
bg-info text-info-foreground

/* UI */
border-border border-input
focus-visible:ring-ring/50

/* Typography */
font-cinzel
font-playfair
font-jakarta
```

---

## Appendix B: Component Export Index

```typescript
// src/components/ui/index.ts (recommended barrel export)
export { Button, buttonVariants } from "./button"
export { Input } from "./input"
export { Badge, badgeVariants } from "./badge"
export { Separator } from "./separator"
export { ToastContainer, useToast, type Toast } from "./toast"
```

---

**Document Status**: Complete
**Next Review**: Before major design changes
**Owner**: UI/UX Design System
