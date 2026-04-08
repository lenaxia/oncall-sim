# UI Design Specification — On-Call Training Simulator

**Date:** 2026-04-07
**Covers:** Phase 7 (component library) and Phase 8 (sim shell + all tabs)
**Status:** Approved — ready to implement

---

## 0. Usage Modes and UX Principles

Before specifying any component, it is essential to understand the different ways users approach this system. Every design decision should serve at least one of these modes without breaking the others.

### 0.1 Usage modes

**Mode 1: First-time trainee**
The trainee has never handled an on-call incident. They don't know what to look at first, don't know the scenario, don't know what "good" looks like. The UX must orient them quickly. They will be anxious and confused. The sim should feel like the real thing: a sudden page, an alert, a flood of information. Their first instinct will be to look at the page (Email). The first experience must feel like getting paged.

**Mode 2: Returning trainee**
Knows the sim, wants to practice deliberately. Will want to move fast, may use speed=10x. Knows which tabs are relevant. The UX must stay out of their way.

**Mode 3: Speed run / efficiency test**
Trainee or assessor running through the scenario as fast as possible at 10x speed. Every interaction must be immediately reachable. No confirmation dialog should be unavoidable — but irreversible actions still need one.

**Mode 4: Instructor-observed session**
An instructor watches while the trainee works. The trainee knows they're being assessed. The UX must be readable at a glance from a distance — severity colours must be unambiguous, badge counts visible, current state obvious.

**Mode 5: Post-incident review**
After completing a debrief, a trainee or instructor reviews the session. All tabs are frozen/read-only. The audit log is the primary artefact. The debrief screen is where learning happens.

### 0.2 UX principles that follow from these modes

1. **The incident start must feel like the real thing.** The scenario drives which tab opens first via `scenario.engine.defaultTab`. A PagerDuty-style scenario starts on Email (the trainee got paged). A Slack-reported "hey something looks weird" scenario starts on Chat. An already-in-progress incident might start on Ops. The default tab is not hardcoded — it is authored per-scenario and must feel natural for that scenario's opening.

2. **The most important information must be visible without switching tabs.** The topbar and tabbar together must communicate the current incident state at all times: the alarm badge on Ops, unread emails, unread chat. The trainee should be able to see at a glance what's demanding attention.

3. **Irreversible actions need friction. Routine actions need none.** Rollback = confirmation modal. End Simulation = confirmation modal. Updating a ticket status = immediate, no confirmation. Posting a chat message = immediate. The distinction must be obvious from the visual weight of the button.

4. **"End Simulation" is clearly distinct from ticket status updates.** Setting a ticket to "resolved" via the status select is routine ticket hygiene — no confirmation, no consequence. Clicking the red "End Simulation" button ends the whole session. These must look nothing alike and be far apart on screen.

5. **The trainee must always know where they are in the incident timeline.** The topbar shows sim-time (T+00:03:42), a progress bar, and the scenario duration. The trainee always knows how far through the incident they are.

6. **The coach is open by default and immediately useful.** The coach panel opens automatically when the session starts with a hardcoded introductory message welcoming the trainee and letting them know guidance will be offered as the incident develops. The trainee can collapse it. On first proactive coach message, the badge draws attention back. The coach never interrupts — it responds and suggests. (Phase 9 adds an interactive chat input; Phase 7 shows guidance messages only.)

7. **The debrief is the learning moment.** The debrief shows a unified incident timeline — trainee actions and simulation events interleaved chronologically. Each evaluation result includes the scenario author's `why` explanation. The trainee understands not just what happened but why it mattered.

---

## 1. Aesthetic and Design Philosophy

The sim is an incident dashboard, not a productivity app. The trainee is under simulated stress. Every design decision serves that context.

**Core principles:**

- **Information density over comfort.** Show as much actionable data as possible. Padding is a cost, not a feature.
- **Monospace everywhere.** Timestamps, log entries, metric values, code — all monospace. The entire app uses `font-mono`. No sans-serif anywhere.
- **Dark terminal aesthetic.** Black-green-grey palette. Every surface feels like a terminal or ops console.
- **Colour is signal only.** Colour communicates severity and status, never decoration. Nothing is coloured just to look interesting.
- **No animation except where it communicates state.** Pulsing on a firing alarm. Spinning on a spinner. Nothing else moves.
- **Desktop-first.** Minimum supported viewport: 1280×768. Below 1280px, the app renders a "viewport too narrow" message. No mobile support.

---

## 2. Colour Tokens

All colours are defined as Tailwind theme extensions. **No hardcoded hex values in component code** — always use token names. Hardcoded values appear only in this spec and in `tailwind.config.js`.

### 2.1 Complete token list

```
/* Surfaces */
sim-bg           #0d1117    outermost background — near-black
sim-surface      #161b22    panel and card backgrounds
sim-surface-2    #1c2128    slightly raised — active tab, hovered row, selected row

/* Borders */
sim-border       #30363d    all primary borders and dividers
sim-border-muted #21262d    subtle dividers inside panels (row separators)

/* Text */
sim-text         #e6edf3    primary body text — off-white
sim-text-muted   #8b949e    secondary: timestamps, metadata, labels, inactive tabs
sim-text-faint   #484f58    placeholder, disabled, section headers in sidebars

/* Interactive */
sim-accent       #1f6feb    links, active tab indicator, focus rings, primary CTA
sim-accent-dim   #0d419d    primary button hover background

/* Status — foreground */
sim-green        #3fb950    success, resolved, healthy, active deployment dot
sim-yellow       #d29922    warning, SEV3, SEV4, paused state
sim-orange       #db6d28    SEV2
sim-red          #f85149    critical, SEV1, ERROR log level, firing alarm

/* Status — background (always paired with their foreground token) */
sim-green-dim    #196127    success badge background
sim-yellow-dim   #4d3900    warning badge background
sim-orange-dim   #5a2000    SEV2 badge background
sim-red-dim      #5d0f0d    critical badge background

/* Info / SEV4 */
sim-info         #0099ff    SEV4, informational
sim-info-dim     #003366    SEV4 badge background

/* Message authorship */
sim-trainee      #79c0ff    trainee messages in chat, email, ticket comments
sim-persona      #d2a8ff    persona messages in chat, email, ticket comments
```

### 2.2 Semantic usage rules

| Use case | Token |
|---|---|
| Page background | `sim-bg` |
| Panels, cards, sidebars | `sim-surface` |
| Active tab, hovered row, selected row | `sim-surface-2` |
| All primary borders | `sim-border` |
| Row-separator borders inside panels | `sim-border-muted` |
| Primary body text | `sim-text` |
| Timestamps, metadata, inactive tab labels | `sim-text-muted` |
| Placeholder text, disabled text, section headers in sidebars | `sim-text-faint` |
| Links, focus rings, active tab underline, primary CTA background | `sim-accent` |
| Primary button hover | `sim-accent-dim` |
| Success / resolved / active | `sim-green` / `sim-green-dim` |
| Warning / SEV3 / paused state | `sim-yellow` / `sim-yellow-dim` |
| SEV2 | `sim-orange` / `sim-orange-dim` |
| Critical / SEV1 / ERROR log / firing alarm | `sim-red` / `sim-red-dim` |
| SEV4 / INFO log / informational | `sim-info` / `sim-info-dim` |
| Trainee authored content | `sim-trainee` |
| Persona authored content | `sim-persona` |

### 2.3 Severity → colour mapping (used consistently everywhere)

| Severity | Foreground token | Background token |
|---|---|---|
| SEV1 | `sim-red` | `sim-red-dim` |
| SEV2 | `sim-orange` | `sim-orange-dim` |
| SEV3 | `sim-yellow` | `sim-yellow-dim` |
| SEV4 | `sim-info` | `sim-info-dim` |

### 2.4 Status → colour mapping

| AlarmStatus | Visual treatment |
|---|---|
| `firing` | SEV badge with `animate-pulse`, row background `bg-sim-red-dim/20` |
| `acknowledged` | SEV badge without pulse, row text `text-sim-text-muted`, label "ack'd" in `text-sim-yellow` |
| `suppressed` | SEV badge at `opacity-40`, row text `text-sim-text-faint`, label "suppressed" in `text-sim-text-faint` |

| DeploymentStatus | Visual treatment |
|---|---|
| `active` | `●` dot in `text-sim-green`, row `bg-sim-surface-2` |
| `previous` | `●` dot in `text-sim-text-faint`, normal row |
| `rolled_back` | `●` dot in `text-sim-orange`, version text `line-through text-sim-text-muted`, "(rolled back)" label in `text-sim-orange` |

| TicketStatus | Visual treatment |
|---|---|
| `open` | `text-sim-text-muted` label |
| `in_progress` | `text-sim-yellow` label |
| `resolved` | `text-sim-green` label |

### 2.5 Log level → colour mapping

| LogLevel | Badge variant | Visual |
|---|---|---|
| `ERROR` | `sev1` | `bg-sim-red-dim text-sim-red` |
| `WARN` | `warning` | `bg-sim-yellow-dim text-sim-yellow` |
| `INFO` | `info` | `bg-sim-info-dim text-sim-info` |
| `DEBUG` | (custom) | `text-sim-text-faint bg-transparent border border-sim-border-muted` |

---

## 3. Typography

**Single font stack applied globally via `body` style:**

```css
font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
```

No sans-serif. Everything is monospace.

### 3.1 Type scale

The global body font-size is **12px (`text-xs`)**. This is the base — the default size for all dense UI elements. `text-sm` (14px) is used only for titles and section-level headings where additional visual weight is needed. Prose content inside `MarkdownRenderer` sets its own size via `.sim-prose`.

| Role | Tailwind classes | Size | Weight | Line height | Used for |
|---|---|---|---|---|---|
| Screen / panel title | `text-sm font-semibold text-sim-text` | 14px | 600 | `leading-tight` | Thread subject, ticket title, tab content headers |
| Section label | `text-xs font-semibold text-sim-text-muted uppercase tracking-wide` | 12px | 600 | `leading-tight` | COMMENTS, ACTIONS, CHANNELS sidebar headers |
| UI body | `text-xs text-sim-text` | 12px | 400 | `leading-tight` | List rows, metadata lines, most UI text |
| Secondary / muted | `text-xs text-sim-text-muted` | 12px | 400 | `leading-tight` | Timestamps, subtitles, hints |
| Timestamp | `text-xs text-sim-text-muted font-mono tabular-nums` | 12px | 400 | `leading-none` | All sim-time values |
| Badge / pill label | `text-xs font-medium font-mono` | 12px | 500 | `leading-none` | Severity badges, status pills |
| Log entry | `text-xs text-sim-text font-mono` | 12px | 400 | `leading-snug` | Log message text |
| Metric value | `text-sm font-semibold text-sim-text` | 14px | 600 | `leading-none` | Current metric value in chart header |
| Table header | `text-xs font-medium text-sim-text-faint uppercase tracking-wide` | 12px | 500 | `leading-tight` | Column headers in tables |
| Input / textarea | `text-xs text-sim-text font-mono` | 12px | 400 | `leading-tight` | All form controls |
| Button label | `text-xs font-medium` | 12px | 500 | `leading-none` | Button text |
| Prose body | see `.sim-prose` in §7 | 14px | 400 | 1.5 | Wiki, email bodies, ticket descriptions via MarkdownRenderer |

`leading-tight` = 1.25. `leading-snug` = 1.375. `leading-none` = 1.

---

## 4. Border Radius

One rule for each component category. Never mix sizes within a category.

| Component type | Radius | Tailwind class |
|---|---|---|
| Cards, panels, modals | 4px | `rounded` |
| Buttons | 4px | `rounded` |
| Inputs, textareas, selects | 4px | `rounded` |
| Badges, pills, tags | 2px | `rounded-sm` |
| Tab notification count pills | full | `rounded-full` |
| Tooltips | 4px | `rounded` |
| Dropdown menus | 4px | `rounded` |
| Charts / metric cards | 4px | `rounded` |
| Tabs | 0px | no rounding (flat tab bar) |

---

## 5. Spacing System

| Usage | Value | Tailwind |
|---|---|---|
| Component internal padding (dense) | 8px | `p-2` |
| Component internal padding (normal) | 12px | `p-3` |
| Modal body padding | 16px | `p-4` |
| Between list rows | 0px | borders only — `border-b border-sim-border-muted` |
| Between sections within a panel | 16px | `gap-4` or `mt-4` |
| Input padding | 4px 12px | `py-1 px-3` (sm) or `py-1.5 px-3` (md) |
| Sidebar list item padding | 8px 12px | `py-2 px-3` |
| Tab bar item padding | 0 16px | `px-4 h-full` |

**Maximum padding anywhere in the sim shell: `p-4` (16px).** The Scenario Picker and Debrief Screen may use larger padding (`p-6`) for their full-page content areas. `EmptyState` uses `p-8` internally — this is intentional because it fills the entire available empty area and the padding creates breathing room around the centred message; it is not nested inside other padding.

---

## 6. Layout Architecture

### 6.1 Viewport and minimum width

Minimum supported width: **1280px**. Below 1280px, render:

```
┌─────────────────────────────────────┐
│  viewport too narrow                 │
│  Resize your browser to at least    │
│  1280px wide to use the simulator.  │
└─────────────────────────────────────┘
```

Centred in viewport, `sim-bg` background, `text-sm text-sim-text-muted`.

### 6.2 Full-app layout

The app has two structural zones: the **main column** (full-width minus coach panel) and the **coach panel** (fixed-width right column). Both span the full viewport height — the coach panel is a sibling of the main column, not nested inside it.

```
┌──────────────────────────────────────────────────┬──────────────┐
│  TOPBAR  h-10  sim-surface  border-b             │              │
│  [Scenario title]  [T+00:03:42]  [1x][2x][5x][⏸]│              │
├──────────────────────────────────────────────────┤  COACH PANEL │
│  TABBAR  h-9  sim-surface  border-b              │              │
│  [Email 2][Chat 5][Tickets][Ops●][Logs][Wiki][CICD][Resolve▶]   │  w-10 or w-80 │
├──────────────────────────────────────────────────┤  border-l    │
│                                                  │              │
│  TAB CONTENT  sim-bg  flex-1  overflow-hidden    │              │
│  (each tab manages its own internal scroll)      │              │
│                                                  │              │
└──────────────────────────────────────────────────┴──────────────┘
```

**Structure (`SimShell`):**
```
<div class="flex h-screen overflow-hidden bg-sim-bg">          {/* outer wrapper */}
  <div class="flex flex-col flex-1 min-w-0 overflow-hidden">   {/* main column */}
    <Topbar />                                                  {/* h-10, flex-shrink-0 */}
    <TabBar />                                                  {/* h-9, flex-shrink-0 */}
    <div class="flex-1 overflow-hidden">                        {/* tab content area */}
      <ActiveTab />                                             {/* manages own scroll */}
    </div>
  </div>
  <CoachPanelShell />          {/* h-full, w-10 collapsed / w-80 expanded, border-l */}
</div>
```

The Resolve button lives inside the TabBar, right-aligned. It is NOT a tab.

### 6.3 Tab content area

Each tab component fills the `flex-1 overflow-hidden` container:
- Tabs **with** sidebars (Email, Chat, Ticketing, Wiki, CI/CD): `flex h-full` → fixed-width left pane + `flex-1` right pane, each `overflow-auto`
- Tabs **without** sidebars: `flex flex-col h-full overflow-hidden` → fixed-height top bar (filter bar or service sub-tabs, `flex-shrink-0`) + `flex-1 overflow-auto` content area below

### 6.4 Sidebar widths across tabs

| Tab | Left sidebar | Justification |
|---|---|---|
| Email | `w-56` (224px) | Needs space for sender name + subject + timestamp on two lines |
| Chat | `w-44` (176px) | Channel names are short (`#incidents`, `@persona`) |
| Ticketing | `w-56` (224px) | Ticket rows show ID + title + status + timestamp |
| Wiki | `w-44` (176px) | Page titles only, no metadata needed in list |
| CI/CD | `w-44` (176px) | Service names only in left column |
| Ops Dashboard | no sidebar | Service sub-tabs rendered horizontally at top of content |

---

## 7. Global CSS

One global CSS file (`src/index.css`) applies base styles before any Tailwind utilities. Tailwind utility classes override these where applied.

```css
/* src/index.css */

@tailwind base;
@tailwind components;
@tailwind utilities;

/* Base */
*, *::before, *::after {
  box-sizing: border-box;
}

html, body, #root {
  height: 100%;
  margin: 0;
  padding: 0;
}

body {
  background-color: #0d1117;  /* sim-bg */
  color: #e6edf3;             /* sim-text */
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 0.75rem;         /* 12px — dense default */
  line-height: 1.25;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Text selection */
::selection {
  background-color: #1f6feb40;  /* sim-accent at 25% opacity */
  color: #e6edf3;
}

/* Scrollbars — WebKit/Blink */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: #30363d;   /* sim-border */
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: #484f58;   /* sim-text-faint */
}
::-webkit-scrollbar-corner {
  background: transparent;
}

/* Firefox scrollbars */
* {
  scrollbar-width: thin;
  scrollbar-color: #30363d transparent;
}

/* Remove default button/input styles */
button {
  cursor: pointer;
  font-family: inherit;
  font-size: inherit;
}

input, textarea, select {
  font-family: inherit;
  font-size: inherit;
}

/* Focus outline — removed globally; components implement custom focus rings */
:focus {
  outline: none;
}
:focus-visible {
  outline: 2px solid #1f6feb;   /* sim-accent */
  outline-offset: 1px;
}

/* .sim-prose — scoped styles for MarkdownRenderer */
.sim-prose {
  color: #e6edf3;
  font-size: 0.875rem;
  line-height: 1.5;
}
.sim-prose h1, .sim-prose h2, .sim-prose h3 {
  color: #e6edf3;
  font-weight: 600;
  margin: 1rem 0 0.5rem;
}
.sim-prose h1 { font-size: 1rem; }
.sim-prose h2 { font-size: 0.875rem; }
.sim-prose h3 { font-size: 0.875rem; color: #8b949e; }
.sim-prose p  { margin: 0.5rem 0; }
.sim-prose code {
  background: #1c2128;
  padding: 0.1em 0.3em;
  border-radius: 3px;
  font-family: inherit;
  color: #79c0ff;
}
.sim-prose pre {
  background: #1c2128;
  border: 1px solid #30363d;
  border-radius: 4px;
  padding: 0.75rem 1rem;
  overflow-x: auto;
  margin: 0.75rem 0;
}
.sim-prose pre code { background: none; padding: 0; }
.sim-prose a { color: #1f6feb; text-decoration: underline; }
.sim-prose a:hover { color: #79c0ff; }
.sim-prose ul, .sim-prose ol { padding-left: 1.25rem; margin: 0.5rem 0; }
.sim-prose li  { margin: 0.25rem 0; }
.sim-prose blockquote {
  border-left: 3px solid #30363d;
  padding-left: 0.75rem;
  color: #8b949e;
  margin: 0.5rem 0;
}
.sim-prose hr  { border-color: #30363d; margin: 1rem 0; }
.sim-prose table { width: 100%; border-collapse: collapse; margin: 0.75rem 0; }
.sim-prose th {
  text-align: left;
  padding: 0.375rem 0.75rem;
  border-bottom: 1px solid #30363d;
  color: #8b949e;
  font-weight: 500;
}
.sim-prose td {
  padding: 0.375rem 0.75rem;
  border-bottom: 1px solid #21262d;
}
```

---

## 8. Component Specifications

### 8.1 Button

```typescript
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'  // default: 'secondary'
  size?:    'sm' | 'md' | 'lg'                             // default: 'md'
  loading?: boolean                                         // shows Spinner, disables interaction
  iconOnly?: boolean                                        // square button for icon-only (× close)
}
```

**Size classes:**

| Size | Normal classes | Icon-only classes |
|---|---|---|
| `sm` | `text-xs px-2.5 py-1 rounded` | `text-xs p-1 rounded` |
| `md` | `text-xs px-3 py-1.5 rounded` | `text-xs p-1.5 rounded` |
| `lg` | `text-sm px-4 py-2 rounded` | `text-sm p-2 rounded` |

**Variant states:**

All variants include `border` in their base to prevent layout shift on hover. Transparent border = no visible border.

| Variant | Normal | Hover | Disabled |
|---|---|---|---|
| `primary` | `bg-sim-accent text-white border border-transparent` | `bg-sim-accent-dim` | `opacity-40 cursor-not-allowed` |
| `secondary` | `bg-sim-surface-2 text-sim-text border border-sim-border` | `border-sim-accent` | `opacity-40 cursor-not-allowed` |
| `danger` | `bg-sim-red text-white border border-transparent` | `bg-sim-red-dim text-sim-red border-sim-red` | `opacity-40 cursor-not-allowed` |
| `ghost` | `text-sim-text-muted bg-transparent border border-transparent` | `text-sim-text bg-sim-surface-2` | `opacity-40 cursor-not-allowed` |

**Note on `danger` hover:** hover state appears dimmer than normal (dim background + border instead of solid fill). This is intentional — slightly reduces visual alarm before the user confirms the action. The 1px layout shift is prevented by having `border border-transparent` in the normal state.

**Note on `secondary` hover:** border changes from `sim-border` to `sim-accent`. Background does not change (stays `sim-surface-2`). The border colour change is the only hover signal — intentional for dense UI.

**Note on `SpeedControl` and `TabBar` Resolve button:** these do NOT use the `Button` primitive. They use custom styled `<button>` elements to achieve specific toggle and bar-integrated appearances. All other buttons in the app use `Button`.

All variants: `font-medium transition-colors duration-100 inline-flex items-center justify-center gap-1.5`

Active (`:active`) state: `opacity-90` on all variants.

**Loading state:** renders `<Spinner size="sm" />` before children text; button is disabled and `cursor-wait`. Children text still visible.

**Accessibility:** `type="button"` by default. Loading sets `aria-busy="true"`. Icon-only buttons require `aria-label` from the caller.

---

### 8.2 Badge

```typescript
interface BadgeProps {
  label:     string
  variant?:  'default' | 'success' | 'warning' | 'info' | 'sev1' | 'sev2' | 'sev3' | 'sev4'
  pulse?:    boolean   // animate-pulse — used ONLY on firing alarm badges in the alarm panel
}
```

All badges: `text-xs font-medium px-1.5 py-0.5 rounded-sm font-mono inline-flex items-center`

| Variant | Background | Text | Used for |
|---|---|---|---|
| `default` | `bg-sim-surface-2` | `text-sim-text-muted` | Tags, neutral labels |
| `success` | `bg-sim-green-dim` | `text-sim-green` | Resolved, healthy |
| `warning` | `bg-sim-yellow-dim` | `text-sim-yellow` | SEV3, WARN log |
| `info` | `bg-sim-info-dim` | `text-sim-info` | SEV4, INFO log |
| `sev1` | `bg-sim-red-dim` | `text-sim-red` | SEV1 severity |
| `sev2` | `bg-sim-orange-dim` | `text-sim-orange` | SEV2 severity |
| `sev3` | `bg-sim-yellow-dim` | `text-sim-yellow` | SEV3 severity |
| `sev4` | `bg-sim-info-dim` | `text-sim-info` | SEV4 severity |

**Note:** `sev3` and `warning` share the same colours — they are distinct variants because one communicates severity (alarm/ticket) and the other communicates log level / general warning state. Using separate variant names makes intent explicit in component code.

**Note:** `pulse` is only used for alarm badges in the alarm panel when `status === 'firing'`. It is NOT used for the `●` firing indicator in the Ops Dashboard service sub-tabs — that indicator is a plain `<span>` with `animate-pulse`, not a Badge.

**Severity helper function** (used throughout tabs):
```typescript
function severityVariant(sev: 'SEV1'|'SEV2'|'SEV3'|'SEV4'): BadgeVariant {
  const map = { SEV1: 'sev1', SEV2: 'sev2', SEV3: 'sev3', SEV4: 'sev4' } as const
  return map[sev]
}

function logLevelVariant(level: 'ERROR'|'WARN'|'INFO'|'DEBUG'): BadgeVariant | 'debug' {
  const map = { ERROR: 'sev1', WARN: 'warning', INFO: 'info', DEBUG: 'debug' } as const
  return map[level]
}
```

`DEBUG` is not a Badge variant — it uses custom classes: `text-sim-text-faint bg-transparent border border-sim-border-muted`.

Tab notification count pills are NOT `Badge` — they are `<span>` elements: `text-xs font-medium bg-sim-red text-white rounded-full px-1.5 min-w-[1.25rem] text-center tabular-nums`.

---

### 8.3 Panel

```typescript
interface PanelProps {
  title?:     string
  actions?:   React.ReactNode   // optional right-side of header (e.g. a button)
  children:   React.ReactNode
  className?: string
  noPadding?: boolean           // omit body padding for tables/lists that need edge-to-edge
}
```

Structure:
```
bg-sim-surface rounded border border-sim-border
  [header — optional]  px-3 py-2 border-b border-sim-border flex items-center justify-between
    text-xs font-semibold text-sim-text-muted uppercase tracking-wide  (title)
    [actions — right side, optional]
  [body]
    p-3  (or no padding if noPadding=true)
```

**Overflow:** Panel does not scroll. If children overflow, the parent container is responsible for scroll behaviour. Panel is always rendered inside a scrollable ancestor.

---

### 8.4 Modal

```typescript
interface ModalProps {
  open:      boolean
  onClose:   () => void
  title:     string
  children:  React.ReactNode
  footer?:   React.ReactNode   // if omitted, no footer rendered
}
```

Structure:
```
[overlay]  fixed inset-0 bg-black/60 z-50 flex items-center justify-center
  [dialog]  bg-sim-surface border border-sim-border rounded w-full max-w-md mx-4
    [header]  px-4 py-3 border-b border-sim-border flex items-center justify-between
      text-sm font-semibold text-sim-text
      [×]  Button variant=ghost size=sm aria-label="Close"
    [body]  p-4
      text-xs text-sim-text
    [footer — optional]  px-4 py-3 border-t border-sim-border flex justify-end gap-2
```

**Behaviour:**
- Renders into a React portal on `document.body`
- Overlay click calls `onClose`
- Escape key calls `onClose`
- Focus trap: on open, focus moves to first focusable element inside `[dialog]`. On Tab, cycles forward through `button, input, textarea, select, a[href]` inside dialog. On Shift+Tab, cycles backward. Focus does not escape the dialog while open.
- Focus trap implementation: scan `dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]')`, store first/last, intercept Tab/Shift+Tab with `event.preventDefault()` and manually move focus.
- Scroll lock: `document.body.style.overflow = 'hidden'` on open, restored on close.
- **Only one modal open at a time** — the app never stacks modals. The scroll lock restoration is therefore safe.
- No animation — instant appear/disappear.

---

### 8.5 Spinner

```typescript
interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'   // default: 'md'
}
```

SVG ring, `animate-spin`, `currentColor` for stroke. Sizes: `sm`=12px, `md`=16px, `lg`=24px.

SVG:
```html
<svg width="{size}" height="{size}" viewBox="0 0 16 16" fill="none" class="animate-spin">
  <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" opacity="0.25"/>
  <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>
```

Colour: inherits from parent text colour via `currentColor`. Default parent: `text-sim-text-muted`.

---

### 8.6 EmptyState

```typescript
interface EmptyStateProps {
  title:    string
  message?: string
  action?:  React.ReactNode   // optional button below message
}
```

Structure: centred in its container with `flex flex-col items-center justify-center h-full gap-2 p-8`

```
∅              ← text-2xl text-sim-text-faint select-none
No emails yet  ← text-sm text-sim-text-muted
Messages will appear here during the incident.  ← text-xs text-sim-text-faint
[optional action button]
```

---

### 8.7 Timestamp

```typescript
interface TimestampProps {
  simTime: number    // sim seconds; negative = pre-incident
  prefix?: string    // default 'T+'; auto-switches to 'T-' for negative values
}
```

Format: `[prefix]HH:MM:SS` where HH may exceed 23 for long scenarios.

The `prefix` prop controls the **positive** prefix only (default: `'T+'`). For negative `simTime` values the component **always** renders `'T-'` regardless of the prefix prop. This means the prefix prop cannot override the sign for negative values — it only customises the positive prefix.

The `formatSimTime` utility function (used directly in chart axis formatters) follows the same logic: `simTime < 0 → 'T-'`, else the provided prefix.

```typescript
// Shared utility — used by both Timestamp component and chart x-axis formatter
export function formatSimTime(simTime: number, prefix = 'T+'): string {
  const abs  = Math.abs(simTime)
  const h    = Math.floor(abs / 3600)
  const m    = Math.floor((abs % 3600) / 60)
  const s    = Math.floor(abs % 60)
  const sign = simTime < 0 ? 'T-' : prefix
  return `${sign}${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}
// Chart x-axis calls formatSimTime(t, 'T') → positive shows 'T00:03:42', negative shows 'T-00:05:00'
// Timestamp component calls formatSimTime(simTime) → positive shows 'T+00:03:42', negative shows 'T-00:05:00'
```

Rendered as: `<span class="text-xs text-sim-text-muted font-mono tabular-nums">`

`tabular-nums` prevents layout shift as digits change.

---

### 8.8 MarkdownRenderer

```typescript
interface MarkdownRendererProps {
  content:    string
  className?: string
}
```

Uses `marked` for parsing, `DOMPurify` for sanitisation. Output injected via `dangerouslySetInnerHTML` **only after** DOMPurify sanitisation.

```typescript
const html = DOMPurify.sanitize(marked.parse(content) as string, {
  ALLOWED_TAGS: ['p','br','h1','h2','h3','h4','ul','ol','li','code','pre',
                 'blockquote','a','strong','em','hr','table','thead','tbody','tr','th','td'],
  ALLOWED_ATTR: ['href'],  // 'class' is intentionally excluded — scenario authors don't need it
})
```

Wrapper: `<div class="sim-prose {className}">`. Prose styles from `src/index.css` §7.

---

### 8.9 Topbar

The topbar communicates the three things a trainee needs to know at all times: what scenario they're in, how far through it they are, and what the current simulation speed is.

```
[Scenario title — truncated]    [T+00:03:42 / T+10:00  ████░░ 37%]    [1x][2x][5x][10x][⏸ Pause]
```

Contains:
- **Left:** scenario title from `useScenario()` — `text-xs text-sim-text-muted truncate max-w-xs`. No prefix label. When null (pre-load), renders empty `<span>`.
- **Centre:** combined clock + progress — see below
- **Right:** `<SpeedControl />` — see §8.10

**Combined clock + progress indicator:**

```
T+00:03:42 / T+10:00   ████░░░░░░  37%
```

- Current sim time: `text-sm font-semibold text-sim-text tabular-nums` — always visible
- Separator ` / ` in `text-sim-text-faint`
- Scenario duration: `text-xs text-sim-text-muted tabular-nums` — format the total duration (e.g. `T+10:00`)
- Progress bar: `w-20 h-1 rounded-full bg-sim-border mx-2` containing a filled portion `bg-sim-accent rounded-full` at `width = (simTime / totalDuration) * 100%`, clamped to [0, 100]
- Percentage: `text-xs text-sim-text-muted tabular-nums`

When `simTime >= totalDuration`: progress bar is full, percentage shows 100%, clock continues beyond duration (scenario doesn't hard-stop).

`totalDuration` comes from `useScenario()` via `ScenarioContext.timelineDurationSeconds`.

Structure: `h-10 flex items-center justify-between px-4 bg-sim-surface border-b border-sim-border flex-shrink-0`

---

### 8.10 SpeedControl

Reads from `useSimClock()`, dispatches via `useSession()`.

```
[1x] [2x] [5x] [10x]  [⏸ Pause]
```

Container: `flex items-center gap-1`

Speed buttons (`1`, `2`, `5`, `10`):
- Base: `text-xs px-2 py-1 rounded border transition-colors duration-100`
- Inactive: `border-sim-border text-sim-text-muted bg-transparent hover:border-sim-accent hover:text-sim-text`
- Active: `border-transparent bg-sim-accent text-white`

Pause button:
- Base: `text-xs px-2 py-1 rounded border transition-colors duration-100`
- Not paused: `border-sim-border text-sim-text-muted hover:border-sim-yellow hover:text-sim-yellow`
- Paused: `border-sim-yellow text-sim-yellow bg-sim-yellow-dim` — **paused state must be visually unambiguous**

All speed control buttons: `aria-pressed` reflects active/paused state.

**Note:** SpeedControl uses custom-styled `<button>` elements, NOT the `Button` primitive. The toggle appearance (active = filled, inactive = bordered) is specific to this component and would require awkward prop combinations on the generic Button.

---

### 8.11 TabBar

```typescript
interface Tab {
  id:       string
  label:    string
  badge?:   number    // unread count; hidden when 0 or undefined
  alarm?:   boolean   // shows pulsing red dot instead of numeric badge (Ops tab)
}

interface TabBarProps {
  tabs:        Tab[]
  activeTab:   string
  onTabChange: (tabId: string) => void
  onResolve:   () => void
  resolveDisabled?: boolean
}
```

Structure: `h-9 flex items-stretch bg-sim-surface border-b border-sim-border flex-shrink-0`

Tab items (`flex-none`): `px-4 h-full flex items-center gap-2 text-xs font-medium cursor-pointer transition-colors duration-75 select-none`
- Inactive: `text-sim-text-muted hover:text-sim-text hover:bg-sim-surface-2`
- Active: `text-sim-text bg-sim-bg border-b-2 border-sim-accent` — `bg-sim-bg` makes the active tab appear to "open" into the content area below

End Simulation button: `ml-auto px-4 h-full text-xs font-semibold bg-sim-red hover:bg-sim-red-dim text-white transition-colors duration-100 flex items-center gap-1.5 flex-none border-l border-sim-border`
- UI label: **"End Simulation"** — the API call behind it is `POST /api/sessions/:id/resolve` but the trainee sees "End Simulation"
- Disabled: `opacity-40 cursor-not-allowed` (when session is not active)
- **Note:** Does NOT use the `Button` primitive — integrated into the TabBar bar height.

Keyboard navigation on TabBar: Left/Right arrow keys move focus and activate the previous/next tab. Home/End jump to first/last tab. Implemented via `onKeyDown` on each tab item with `role="tab"`, `aria-selected`, within a `role="tablist"`.

---

### 8.12 ScenarioPicker

Full-page screen, replaces the sim shell entirely.

```
┌──────────────────────────────────────────────────────────────────┐
│  bg-sim-surface border-b border-sim-border h-14 px-6             │
│  On-Call Training Simulator   ← text-base font-semibold          │
│  Select a scenario to begin   ← text-xs text-sim-text-muted mt-1 │
├──────────────────────────────────────────────────────────────────┤
│  bg-sim-bg flex-1 overflow-auto p-6                               │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  bg-sim-surface border border-sim-border rounded p-4        │  │
│  │  hover:border-sim-accent transition-colors duration-100     │  │
│  │                                                             │  │
│  │  API Error Rate Spike           ← text-sm font-semibold     │  │
│  │  api · medium · ~10 min         ← text-xs text-muted        │  │
│  │                                                             │  │
│  │  A bad deployment causes p99 latency to spike...            │  │
│  │                          ← text-xs text-muted mt-1          │  │
│  │                                                             │  │
│  │  [rollback][latency][deployment]             [Start →]      │  │
│  │  ← Badge variant=default (tags)        Button primary sm    │  │
│  └─────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

**`text-base` note:** The picker header uses `text-base` (16px) as a deliberate one-off exception — it is a full-page title, not dense sim UI. This is the only place in the app that uses `text-base`. It is intentional and does not violate the type scale for the sim shell.

**Card metadata line:** `api · medium · ~10 min` — format the estimated duration from `scenario.engine.timelineDurationSeconds` as:
- `< 120s` → show in seconds: `~{N}s`
- `< 3600s` → show in minutes: `~{N} min` (round to nearest minute, minimum 1)
- `>= 3600s` → show in hours+minutes: `~{h}h {m}m`

The duration is derived from `ScenarioConfig.engine.timelineDurationSeconds`. Displaying it helps Mode 1 users calibrate their session and helps Mode 4 instructors schedule assessment time.

Scenario list: `max-w-2xl mx-auto flex flex-col gap-3`

Loading state: `Spinner size=md` + `text-xs text-sim-text-muted` centred in content area.

Error state: `EmptyState title="Failed to load scenarios" message="Ensure the server is running on port 3001."`

Clicking a card highlights it (`border-sim-accent bg-sim-surface-2`) but does NOT start the session. Starting requires explicitly clicking the [Start →] button inside the card.

**Click behaviour:**
- Clicking anywhere on the card body (but NOT on the Start button): highlight the card, clear any previous highlight
- Clicking the Start button: immediately begins session creation for this card's scenario (Start button itself triggers loading state — no separate card highlight step needed)

The Start button triggers a loading state on the button only (`loading={true}` on Button) while the session is being created. The card does not show a separate loading overlay.

---

### 8.13 SimShell

Top-level layout component. Receives `sessionId` as prop.

```typescript
interface SimShellProps {
  sessionId:   string
  scenarioId:  string
  onExpired:   () => void       // navigate to picker
  onDebrief:   () => void       // navigate to debrief
}
```

Active tab stored in local state, initialised from **`scenario.engine.defaultTab`** (read from `ScenarioContext` when the session starts). This means a Chat-reported incident opens on Chat, an email/page incident opens on Email. **Tab order is fixed** (Email → Chat → Tickets → Ops → Logs → Wiki → CI/CD) regardless of which tab is initially active. The default tab from the scenario only affects which tab is active on first load, not the tab order.

Reconnection banner: rendered between TabBar and tab content when `reconnecting === true` from `useSSE`:
```
bg-sim-yellow-dim text-sim-yellow text-xs px-4 py-1.5 flex items-center gap-2 flex-shrink-0
⚠  Connection lost — reconnecting...
```
This is a non-fixed element in the layout flow (not absolute), so it pushes tab content down by its height. This is intentional — the trainee needs to see it clearly.

Initial connecting state (before first `session_snapshot`): full tab-content area shows:
```
Spinner size=lg + "Connecting..." text-xs text-sim-text-muted
```

During the connecting state, `Topbar` renders with the scenario title (already known from `ScenarioContext`, fetched before navigation to sim) and `T+00:00:00` for the clock. The SpeedControl buttons are visible but disabled until `connected === true` (no point changing speed before the session starts). The TabBar renders all tabs, and the "End Simulation" button is disabled until `connected === true`.

The session starts **running** (not paused) from the server's perspective as soon as it is created. The `sim_time` events begin flowing immediately. The trainee may not see any action for the 1–2 seconds it takes to connect, but the clock is already ticking. This is intentional — the "sudden page" experience begins the moment the session is created, not when the UI connects.

**Resolving overlay** (`resolving === true`, between End Simulation confirm and debrief navigation):

While waiting for debrief generation, the sim shell remains visible but an overlay is shown over the tab content area only (not the topbar or tabbar):

```
[tab content area — position: relative]
  [overlay — absolute inset-0 bg-sim-bg/80 z-10 flex flex-col items-center justify-center gap-3]
    Spinner size=lg  text-sim-text-muted
    text-xs text-sim-text-muted  "Generating debrief..."
    text-xs text-sim-text-faint  "This may take a few seconds."
```

The topbar clock continues running (SSE still connected). The TabBar tabs are visible but the End Simulation button now shows as disabled. The coach panel remains visible. The overlay makes it unambiguous that something is happening and the trainee cannot take further actions — without navigating away and abandoning the live sim state during generation.

---

### 8.14 CoachPanelShell

```typescript
interface CoachPanelShellProps {
  children?:   React.ReactNode   // Phase 9 inserts coach chat UI here
  badgeCount?: number            // unread coach messages
}
```

Two modes, toggled by local `open` state. **`open` defaults to `true`** — the coach panel is open when the session starts.

**Collapsed (`w-10`):**
```
border-l border-sim-border bg-sim-surface flex flex-col items-center h-full
  [toggle button — position:relative, w-10, py-3, flex flex-col items-center]
    text-sim-text-muted hover:text-sim-text  "Coach" (rotated 90°, text-xs)  (aria-label="Open coach panel")
    [badge dot — position:absolute top-2 right-1.5]
      w-2 h-2 rounded-full bg-sim-red
      shown only when badgeCount > 0
```

The badge dot is positioned `absolute` within the toggle button (which is `relative`). It appears in the top-right corner of the toggle tab.

**Expanded (`w-80`):**
```
border-l border-sim-border bg-sim-surface flex flex-col
  [header h-10 px-3 border-b border-sim-border flex items-center justify-between]
    text-xs font-semibold text-sim-text  "Coach"
    [›] Button variant=ghost size=sm aria-label="Collapse coach panel"  (right-pointing chevron)
  [content area flex-1 overflow-auto p-3]
    [intro message — always shown at top, before any server messages]
    [server coach messages below — Phase 9]
    [Phase 7: below the intro message, render coachMessages from SessionState — text only, same card style as intro but without the "Coach" label; empty list = only the intro message is shown]
    [Phase 7: no input textarea — the chat input is Phase 9]
```

**Introductory message** (hardcoded client-side, always the first item in the coach panel):
```
bg-sim-surface-2 border border-sim-border-muted rounded p-3 mb-3
  text-xs text-sim-text-muted font-semibold mb-1  "Coach"
  text-xs text-sim-text leading-snug
  "Welcome to the simulation. I'm your coach.
   Work through the incident as you would in real life.
   I'll offer guidance as the incident develops."
```

This message is client-side only — not from the server, not in `coachMessages[]`. It is always visible and always first.

**Note on Phase 7 vs Phase 9:** Phase 7 shows this intro message plus any `coachMessages` that arrive via SSE. There is no text input — the trainee cannot ask the coach questions until Phase 9 adds the input UI. The intro message is worded to not promise an interactive chat, just guidance.

---

### 8.15 DebriefScreen

Shown after `debrief_ready` SSE event and successful `GET /api/sessions/:id/debrief`.

```typescript
interface DebriefScreenProps {
  sessionId:   string
  scenarioId:  string
  onBack:      () => void                          // ← New Scenario — returns to picker
  onRunAgain:  (scenarioId: string) => void        // ↺ Run Again — new session, same scenario
}
```

**Waiting state:** handled by the resolving overlay on `SimShell` (§8.13) — DebriefScreen is only ever mounted after debrief data is available. There is no waiting state rendered by DebriefScreen itself.

**Loaded state:**

```
bg-sim-bg h-screen flex flex-col overflow-hidden
  [header h-10 sim-surface border-b border-sim-border px-4 flex items-center justify-between]
    text-sm font-semibold  "Incident Debrief — {scenario title}"
    flex items-center gap-2:
      Button variant=ghost size=sm  "↺ Run Again"  ← calls onRunAgain
      Button variant=secondary size=sm  "← New Scenario"  ← calls onBack

  [body flex-1 overflow-hidden flex]

    [left column — flex-1 flex flex-col overflow-hidden border-r border-sim-border]

      [Phase 9 narrative placeholder — flex-shrink-0]
        bg-sim-surface-2 rounded border border-sim-border-muted m-4 p-3 text-xs text-sim-text-faint
        "AI debrief narrative — Phase 9"

      [Incident Timeline — flex-1 overflow-auto]
        Unified chronological list: auditLog entries AND eventLog entries, sorted by simTime ascending.

        Each timeline entry:
          flex items-start gap-3 py-2 px-4 border-b border-sim-border-muted
          [left: Timestamp — text-xs text-sim-text-muted tabular-nums w-24 flex-shrink-0]
          [icon — w-4 flex-shrink-0 text-center]:
            auditLog action:  ▶  text-sim-accent
            alarm_fired:      ●  text-sim-red
            email_received:   ✉  text-sim-text-muted
            chat_message:     »  text-sim-text-muted  (chevron double, not emoji)
            page_sent:        ⊞  text-sim-text-muted  (pager glyph)
            deployment:       ↑  text-sim-green
            other eventLog:   ·  text-sim-text-faint
          [description — flex-1 text-xs text-sim-text]:
            auditLog: human-readable action label (see label map below) + " — " + key param summary in text-sim-text-muted
            eventLog: human-readable (e.g. "Alarm fired: error_rate_p99 breached critical threshold")
          [eval badge — w-4 flex-shrink-0 text-right — auditLog entries only]:
            ✓  text-sim-green  (if action in relevantActionsTaken)
            ✗  text-sim-red    (if action in redHerringsTaken)
            (nothing for neutral actions)

        Empty timeline (no audit entries, no event log entries):
          EmptyState title="No actions recorded" message="End the simulation after taking actions to see the timeline."

    [right column — w-[38%] flex-shrink-0 flex flex-col gap-4 p-4 overflow-auto]

      [evaluation Panel — title="Evaluation" noPadding=true]
        Each row: px-3 py-2 border-b border-sim-border-muted

        Row type A — relevant action taken (✓):
          flex items-start gap-2
          text-sim-green "✓" flex-shrink-0
          flex flex-col gap-0.5
            text-xs text-sim-text font-medium  action label
            text-xs text-sim-text-muted  why (scenario author's explanation)

        Row type B — red herring taken (✗):
          flex items-start gap-2
          text-sim-red "✗" flex-shrink-0
          flex flex-col gap-0.5
            text-xs text-sim-text font-medium  action label
            text-xs text-sim-text-muted  why

        Row type C — relevant action missed (○):
          flex items-start gap-2
          text-sim-text-faint "○" flex-shrink-0
          flex flex-col gap-0.5
            text-xs text-sim-text-muted font-medium  action label + " (missed)"
            text-xs text-sim-text-faint  why

        Empty evaluation (no relevant actions, no red herrings in scenario):
          text-xs text-sim-text-faint px-3 py-4  "No evaluation criteria defined for this scenario."

        Bottom of panel (always shown):
          resolved=true:   text-sim-green "✓ Incident marked resolved"
          resolved=false:  text-sim-text-muted "○ Incident not explicitly resolved"

      [stats Panel — title="Stats"]
        Two-column key-value layout: text-xs rows, key=text-sim-text-muted, value=text-sim-text
          Resolved at:     T+HH:MM:SS  (or "—" if not resolved)
          Duration:        T+HH:MM:SS  (resolvedAtSimTime formatted)
          Actions taken:   N
          Relevant:        N / total_relevant
          Red herrings:    N
          Time to first action:  T+HH:MM:SS  (simTime of first auditLog entry)
```

`onRunAgain` creates a new session for the same `scenarioId`. It does NOT bypass session creation — same flow as the Start button on the picker.

**Action label map** (used for auditLog entries in the incident timeline description):

```typescript
const ACTION_LABELS: Record<string, string> = {
  open_tab:                'Opened tab',
  investigate_alert:       'Investigated alarm',
  ack_page:                'Acknowledged alarm',
  suppress_alarm:          'Suppressed alarm',
  page_user:               'Paged user',
  direct_message_persona:  'Started DM',
  view_metric:             'Viewed metric',
  search_logs:             'Searched logs',
  read_wiki_page:          'Read wiki page',
  view_deployment_history: 'Viewed deployments',
  update_ticket:           'Updated ticket',
  add_ticket_comment:      'Commented on ticket',
  mark_resolved:           'Marked ticket resolved',
  trigger_rollback:        'Triggered rollback',
  trigger_roll_forward:    'Triggered roll-forward',
  restart_service:         'Restarted service',
  scale_cluster:           'Scaled cluster',
  throttle_traffic:        'Throttled traffic',
  emergency_deploy:        'Emergency deploy',
  toggle_feature_flag:     'Toggled feature flag',
}
// Fallback for unknown types: use the raw actionType string
```

**Key param summary** (the muted text after " — " in the timeline entry description):
- `open_tab`: `{tab}`
- `investigate_alert` / `ack_page` / `suppress_alarm`: `{alarmId}`
- `page_user`: `@{personaDisplayName}` (resolve personaId → displayName using ScenarioContext)
- `view_metric`: `{metricId} ({service})`
- `search_logs`: `"{query}"`
- `read_wiki_page`: `"{pageTitle}"`
- `view_deployment_history`: `{service}`
- `update_ticket` / `add_ticket_comment` / `mark_resolved`: `{ticketId}`
- `trigger_rollback` / `trigger_roll_forward`: `{service} → {version}`
- `restart_service` / `scale_cluster` / `throttle_traffic` / `emergency_deploy`: `{service}`
- `toggle_feature_flag`: `{flag} → {enabled ? 'enabled' : 'disabled'}`
- All others or missing params: omit the " — " summary entirely

---

### 8.16 PageUserModal

A standalone modal component extracted for reuse. Used by OpsDashboardTab alarm rows and the standalone [+ Page User] button.

```typescript
interface PageUserModalProps {
  open:         boolean
  onClose:      () => void
  onSubmit:     (personaId: string, message: string) => void
  personas:     PersonaConfig[]
  alarmId?:     string    // pre-fill context line if opened from alarm row
  alarmLabel?:  string    // e.g. "error_rate > 5% — fixture-service"
}
```

Internal state: `selectedPersonaId: string`, `message: string`.

Validation:
- `selectedPersonaId` must be non-empty
- `message` must be at least 10 characters (forces the trainee to be specific)
- Submit button disabled until both valid

On mount: if only one persona, pre-select it. Focus lands on the message textarea.

Full structure is specified in §12.4 OpsDashboard ("Page User Modal").

---

### 8.17 ErrorToast

A transient notification for API failures (§19.1). Lives at the app level in `App.tsx` — rendered in a React portal so it is always on top of tab content and modals.

```typescript
interface ErrorToastProps {
  message: string | null   // null = not visible
  onDismiss: () => void
}
```

Structure:
```
fixed bottom-4 right-4 z-[60] flex items-center gap-2
bg-sim-red-dim border border-sim-red text-sim-red text-xs px-3 py-2 rounded
  [!] icon  flex-shrink-0 font-bold
  message text  flex-1
  [×] Button variant=ghost size=sm aria-label="Dismiss"  flex-shrink-0
```

Behaviour:
- Only visible when `message` is non-null
- No animation — instant appear/disappear (consistent with no-animation rule)
- Auto-dismisses after 4 real seconds (`setTimeout` in `App.tsx`, cleared on manual dismiss)
- At most one toast visible at a time — new error replaces the current message and resets the 4s timer
- Does not block interaction with the rest of the app (fixed position, no overlay)

`App.tsx` manages `toastMessage: string | null` state and passes it to `ErrorToast`. SessionContext calls a provided `onError` callback when an API call fails; App maps this to `setToastMessage`.

---

## 9. Context and Hook Specifications

These are the contracts that all components depend on. Every consumer must use the hook or context — direct state manipulation is prohibited.

---

### 9.1 SessionContext

Holds the live simulation state, driven entirely by SSE events. All tab components read from this context; none hold server-sourced state locally.

```typescript
interface SessionState {
  // Connection
  connected:    boolean          // true after first session_snapshot received
  reconnecting: boolean          // true while SSE is reconnecting

  // Sim clock (updated by sim_time events)
  simTime:   number              // current sim time in seconds
  speed:     1 | 2 | 5 | 10
  paused:    boolean
  status:    'active' | 'resolved' | 'expired'

  // Snapshot data (updated by individual SSE events after the initial session_snapshot)
  tickets:         Ticket[]
  alarms:          Alarm[]
  emails:          Email[]
  chatMessages:    Record<string, ChatMessage[]>  // key = channelId
  logs:            LogEntry[]
  deployments:     Record<string, Deployment[]>   // key = serviceName
  metrics:         Record<string, MetricPoint[]>  // key = metricId — full pre-generated series
  auditLog:        AuditEntry[]
  pages:           PageAlert[]
  coachMessages:   CoachMessage[]
}

// Key domain types referenced throughout the spec:
interface Deployment {
  version:     string              // e.g. "v1.2.3" or "abc1234" — display as-is in the table
  deployedAt:  number              // sim-seconds; negative = pre-incident
  status:      'active' | 'previous' | 'rolled_back'
  author:      string
  commitMsg:   string
}

interface Alarm {
  id:         string
  service:    string
  severity:   'SEV1' | 'SEV2' | 'SEV3' | 'SEV4'
  condition:  string               // e.g. "error_rate_p99 > 0.05"
  status:     'firing' | 'acknowledged' | 'suppressed'
  firedAt:    number               // sim-seconds
}
```

**SSE event → state update mapping (full):**

| SSE event type | State mutation |
|---|---|
| `session_snapshot` | Replace entire state with snapshot payload; set `connected = true` |
| `sim_time` | Update `simTime`, `speed`, `paused` only — **do not touch ticket/alarm/etc. arrays** |
| `chat_message` | Append to `chatMessages[event.channel]`; create array if missing |
| `email_received` | Append to `emails`, **unless** it is a trainee-reply echo: skip if `emails` already contains an entry where `from === 'trainee'` AND `threadId === event.threadId` AND `body === event.body` AND `abs(existing.simTime - event.simTime) < 5` (dedup window is 5 sim-seconds). This suppresses the server echo of the optimistic reply. |
| `log_entry` | Append to `logs` |
| `alarm_fired` | Append to `alarms` |
| `alarm_silenced` | Find alarm by id, set `status = 'suppressed'` |
| `alarm_acknowledged` | Find alarm by id, set `status = 'acknowledged'` |
| `ticket_created` | Append to `tickets` |
| `ticket_updated` | Merge `event.changes` into existing ticket (partial update — do not replace whole object) |
| `ticket_comment` | Not tracked in `SessionState` — `ticketComments` are on `Ticket.comments[]` array; `ticket_comment` event appends to the correct ticket's `comments` array |
| `deployment_update` | Replace `deployments[event.service]` with `event.deployments` |
| `page_sent` | Append to `pages` |
| `coach_message` | Append to `coachMessages` |
| `session_expired` | Set `status = 'expired'`; call `onExpired` callback |
| `debrief_ready` | Call `onDebriefReady` callback; **do not** change session state |
| `metric_update` | Ignored in Phase 7 (metrics are pre-generated; full series in initial snapshot) |
| `error` | `console.error(event.code, event.message)`; no state change |

**Context shape:**

```typescript
interface SessionContextValue {
  state: SessionState

  // Action dispatch — all fire-and-forget (204 expected; errors handled globally per §19)
  dispatchAction: (type: ActionType, params?: Record<string, unknown>) => void
  postChatMessage: (channel: string, text: string) => void
  replyEmail: (threadId: string, body: string) => void
  setSpeed: (speed: 1 | 2 | 5 | 10) => void
  setPaused: (paused: boolean) => void
  resolveSession: () => Promise<void>   // POST /resolve; sets resolving=true locally
  resolving: boolean                    // true between resolve() call and debrief_ready
}

interface SessionProviderProps {
  sessionId:      string
  onExpired:      () => void
  onDebriefReady: () => void
  onError:        (message: string) => void   // called on any API failure; App maps to toast
  children:       React.ReactNode
}
```

`onError` is a prop on `<SessionProvider>`, not a field on the context value — tab components never call it directly. When any API call returns non-2xx, `SessionProvider` calls `props.onError` with a human-readable message. `App.tsx` passes `setToastMessage` as `onError`.

`dispatchAction` is a no-op when `state.status !== 'active'`. `postChatMessage` and `replyEmail` are similarly no-ops when inactive.

**Hook:** `export function useSession(): SessionContextValue`

Throws if used outside `<SessionProvider>`.

---

### 9.2 ScenarioContext

Read-only scenario metadata fetched once when the session starts. Never changes during a session.

```typescript
interface ScenarioConfig {
  id:                      string
  title:                   string
  description:             string
  serviceType:             string
  difficulty:              string
  tags:                    string[]
  topology: {
    focalService:  string
    upstream:      string[]
    downstream:    string[]
  }
  personas:                PersonaConfig[]   // id, displayName, jobTitle, team, systemPrompt
  wikiPages:               Array<{ title: string; content: string }>
  featureFlags:            Array<{ id: string; label: string }>   // empty array if none configured
  cicd:                    { pipelines: Array<{ service: string; steps: string[] }> }
  evaluation: {
    rootCause:         string
    relevantActions:   Array<{ action: string; why: string }>
    redHerrings:       Array<{ action: string; why: string }>
    debriefContext:    string
  }
  engine: {
    defaultTab:              TabId
    timelineDurationSeconds: number
    hasFeatureFlags:         boolean   // true if featureFlags array is non-empty
  }
}

interface ScenarioContextValue {
  scenario: ScenarioConfig | null   // null until loaded
}
```

**Hook:** `export function useScenario(): ScenarioContextValue`

`scenario` is `null` during the brief window between session creation and scenario fetch completion. All consumers must guard `if (!scenario) return null`.

`hasFeatureFlags` on `engine` controls whether the Toggle Feature Flag button appears in CICDTab (§12.7).

---

### 9.3 useSSE

Manages the `EventSource` lifecycle, JSON parsing, and reconnection with exponential backoff.

```typescript
interface UseSSEOptions {
  sessionId:       string
  onEvent:         (event: SimEvent) => void
  onExpired:       () => void
  onDebriefReady:  () => void
}

interface UseSSEResult {
  connected:    boolean
  reconnecting: boolean
}

export function useSSE(options: UseSSEOptions): UseSSEResult
```

**Implementation contract:**

- URL: `/api/sessions/{sessionId}/events`
- On `message` event: parse `event.data` as JSON → call `options.onEvent`
- Ignore lines where `event.data` starts with `:` (SSE comment / heartbeat)
- Ignore malformed JSON silently (no crash, no state change)
- On `error` event from `EventSource`: set `reconnecting = true`, close the current `EventSource`, schedule reconnect with backoff
- **Reconnection backoff:** `1s → 2s → 4s → 8s → 16s → 30s (max)`. Each failed reconnect attempt doubles the delay, capped at 30s. On successful reconnect (first `message` received), reset backoff to 1s.
- On unmount: `eventSource.close()`, clear any pending reconnect timeout
- `connected` is `true` after the first message is received on a (re)connect. It goes back to `false` only transiently during reconnect.

**sim_time event payload shape** (for `onEvent` consumers):

```typescript
interface SimTimeEvent {
  type:    'sim_time'
  simTime: number
  speed:   1 | 2 | 5 | 10
  paused:  boolean
}
```

This is the shape received on the wire. SessionContext maps it to `state.simTime / state.speed / state.paused`.

---

### 9.4 useSimClock

Interpolates the sim clock between `sim_time` SSE events using `requestAnimationFrame`, so the displayed clock ticks smoothly at any speed without relying on server events every second.

```typescript
interface UseSimClockResult {
  simTime:  number    // interpolated sim seconds (floating point; floor when displaying)
  display:  string    // pre-formatted 'T+HH:MM:SS' string
  speed:    1 | 2 | 5 | 10
  paused:   boolean
}

export function useSimClock(): UseSimClockResult
```

**Implementation contract:**

- Reads `state.simTime`, `state.speed`, `state.paused` from `useSession()`
- On each SSE `sim_time` event, records `{ serverSimTime, realTimestamp: Date.now() }` as the sync anchor
- On each `requestAnimationFrame` tick:
  - If `paused`: `interpolated = serverSimTime` (frozen)
  - If not paused: `interpolated = serverSimTime + (Date.now() - realTimestamp) / 1000 * speed`
  - Update `display` using `formatSimTime(Math.floor(interpolated))`
- Cancels `requestAnimationFrame` handle on unmount
- If no sync anchor yet (before first `sim_time` event): `simTime = state.simTime`, `display = formatSimTime(state.simTime)`

`display` is a pre-formatted string so consumers (Topbar) don't reformat on every frame.

---

## 10. Screen Navigation

```typescript
type AppScreen = 'picker' | 'sim' | 'debrief'
```

| From | To | Trigger |
|---|---|---|
| `picker` | `sim` | Trainee clicks Start; session creation + scenario fetch succeed |
| `sim` | `debrief` | `debrief_ready` SSE event received AND `GET /debrief` returns 200 |
| `sim` | `picker` | `session_expired` SSE event received |
| `debrief` | `picker` | Trainee clicks "← New Scenario" |

No transitions between screens — instant swap. Screen state lives in `App.tsx`.

**Picker → Sim:**
1. Trainee clicks Start
2. Card shows loading state (Spinner on Start button)
3. POST `/api/sessions` → get sessionId
   - On failure (non-201): stop loading state, show `EmptyState title="Failed to start session" message="Could not create the session. Please try again."` in the picker content area, do not navigate
4. GET `/api/scenarios/:id` → populate ScenarioContext
   - On failure: stop loading state, show `EmptyState title="Failed to load scenario" message="Could not start the session. Please try again."` in the picker, do not navigate
5. Navigate to `sim` screen
6. SimShell connects to SSE and shows connecting spinner until first `session_snapshot`

**Sim → Debrief:**
1. Trainee clicks "End Simulation" button in TabBar → confirmation modal → confirms
2. POST `/api/sessions/:id/resolve` → 202
3. Screen stays on `sim` with resolving overlay (§8.13)
4. Simultaneously: listen for `debrief_ready` SSE event AND start polling `GET /api/sessions/:id/debrief` every 2 real seconds
5. When `GET /debrief` returns 200: stop polling, store debrief data, navigate to `debrief` screen
6. If `debrief_ready` SSE event arrives before polling succeeds: make one immediate `GET /debrief` request; if 200, navigate; if not yet ready, continue polling
7. Hard timeout after 30 real seconds: navigate to `debrief` screen regardless — `DebriefScreen` will retry the fetch on mount

**`DebriefScreen` fetch-on-mount:** `DebriefScreen` always fetches `GET /api/sessions/:id/debrief` on mount. If data was already fetched before navigation (normal path), the fetch is skipped (use cached data). If navigated via the 30s timeout before data is ready, `DebriefScreen` shows a minimal loading state:

```
bg-sim-bg h-screen flex flex-col items-center justify-center gap-3
  Spinner size=lg
  text-xs text-sim-text-muted  "Loading debrief..."
```

It retries every 3 real seconds until data arrives. No timeout on this retry — the debrief will eventually be ready. This state is rarely seen in practice (only if LLM generation takes >30s).

**Sim → Picker (expired):**
1. `session_expired` SSE event arrives
2. Show full-screen overlay:
   ```
   fixed inset-0 bg-black/80 z-50 flex items-center justify-center
     bg-sim-surface border border-sim-border rounded p-6 max-w-sm
       text-sm font-semibold  "Session Expired"
       text-xs text-sim-text-muted mt-2  "Your session was disconnected."
       Button variant=primary mt-4  "Return to Scenario Picker"  ← navigates to picker
   ```
3. User must click the button — no auto-redirect.

---

## 11. Form Inputs

### 11.1 Input fields

Base classes (applied to all `<input>`, `<textarea>`, `<select>`):
```
w-full bg-sim-surface border border-sim-border text-sim-text text-xs font-mono
px-3 rounded outline-none transition-colors duration-100
placeholder:text-sim-text-faint
```

`w-full` is always applied — inputs always fill their container. Never use a fixed width on form controls.

Height variants:
- `sm` (default for sim): `py-1` → 24px total
- `md`: `py-1.5` → 28px total

**States:**

| State | Classes |
|---|---|
| Normal | `border-sim-border` |
| Focus | `border-sim-accent ring-1 ring-sim-accent ring-offset-0` |
| Error | `border-sim-red ring-1 ring-sim-red` |
| Disabled | `opacity-40 cursor-not-allowed bg-sim-surface border-sim-border` |

Error message (below input):
```
text-xs text-sim-red mt-1
```

### 11.2 Textarea

Same classes as input plus:
- `resize-none` — no manual resize
- `min-h-[60px]` — minimum height for reply boxes
- `max-h-[120px]` — maximum height; overflows with scroll
- Disabled when session is not active (`status !== 'active'`)

### 11.3 Select

Same base classes as input plus:
- `cursor-pointer`
- `appearance-none` — removes browser default arrow
- Custom dropdown arrow via background SVG (data-uri):

```css
background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%238b949e' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
background-repeat: no-repeat;
background-position: right 8px center;
padding-right: 24px;  /* pr-6 — make room for the arrow */
```

As Tailwind: `pr-6 bg-no-repeat bg-[right_8px_center] bg-[url(...svg-data-uri...)]`

On focus: same focus ring as input (`border-sim-accent ring-1 ring-sim-accent`).
On disabled: `opacity-40 cursor-not-allowed`.

### 11.4 Input validation

Required fields are validated on submit (not on blur). Validation is client-side only:
- Empty required field: apply error state to input, show error message below
- Clear error state when field value changes
- No server-round-trip for validation

---

## 12. Tab-Level UI Specifications

### 12.1 EmailTab

**Layout:** `flex h-full`

Left: `w-56 border-r border-sim-border overflow-auto flex-shrink-0 bg-sim-surface`
Right: `flex-1 flex flex-col overflow-hidden`

**Left — inbox row** (one per email thread; the row represents the most-recent email in the thread by `simTime`):
```
[unread dot]  sender name        T+00:02:15
              subject truncated…
```
- Container: `px-3 py-2 border-b border-sim-border-muted cursor-pointer hover:bg-sim-surface-2 transition-colors duration-75`
- Selected: `bg-sim-surface-2`
- Unread dot: `w-1.5 h-1.5 rounded-full bg-sim-accent flex-shrink-0 mt-1` — `invisible` when read (space is preserved to prevent layout shift)
- Sender: `text-xs font-medium` — `text-sim-text` if unread, `text-sim-text-muted` if read
- Timestamp: `text-xs text-sim-text-muted tabular-nums ml-auto flex-shrink-0`
- Subject: `text-xs text-sim-text-muted truncate mt-0.5`

**Threading logic:** group `snapshot.emails` by `threadId`. Sort threads by `max(simTime)` descending. Display the email with the highest `simTime` in each group as the inbox row. Thread view shows all emails in the thread sorted by `simTime` ascending.

Empty state: `EmptyState title="No emails" message="Emails will arrive during the incident."`

**Right — thread view:**

Thread header: `px-3 py-2 border-b border-sim-border flex-shrink-0 bg-sim-surface`
- Subject: `text-xs font-semibold text-sim-text`

Thread messages: `flex-1 overflow-auto px-3 py-2 flex flex-col`

Each message:
```
[border-t border-sim-border-muted pt-3 mt-3 — first message has no border-t]
[sender name — text-sim-persona or text-sim-trainee]  [T+HH:MM:SS]   ← text-xs font-semibold flex justify-between
[email body via MarkdownRenderer]
```
**Note:** messages use `border-t` only for separation — do NOT add `gap-3` to the messages container as that would create double-spacing between the border and the gap.

Empty thread (no thread selected): `EmptyState title="Select an email" message="Click an email to view the thread."`

Reply box: `border-t border-sim-border p-3 flex-shrink-0 bg-sim-surface`
```
<textarea placeholder="Reply..." min-h-[60px] max-h-[120px]>
[Send]  Button variant=primary size=sm  — disabled when textarea empty or session inactive
```

**Reply send behaviour:** on Send click, call `replyEmail(threadId, body)`. **Optimistic update:** immediately append a new `Email` object to the thread's message list with `from = 'trainee'`, `threadId`, and the typed body, then clear the textarea. The `SessionContext` `email_received` handler suppresses the server echo — see §9.1 for the dedup rule. EmailTab renders `state.emails` directly with no dedup logic of its own.

---

### 12.2 ChatTab

**Layout:** `flex h-full`

Left: `w-44 border-r border-sim-border overflow-auto flex-shrink-0 bg-sim-surface flex flex-col`
Right: `flex-1 flex flex-col overflow-hidden`

**Left — channel sidebar:**

Section headers:
```
CHANNELS  ← text-xs font-semibold text-sim-text-faint px-3 pt-3 pb-1 uppercase tracking-wide
```

Channel item: `flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors duration-75`
- Inactive: `text-sim-text-muted hover:bg-sim-surface-2 hover:text-sim-text`
- Active: `bg-sim-surface-2 text-sim-text`
- Channel name prefix: `text-xs` — `#` for channels, `@` for DMs
- Unread badge: `ml-auto text-xs font-medium bg-sim-red text-white rounded-full px-1.5 min-w-[1.25rem] text-center tabular-nums`

DMs section header same style as CHANNELS. DM items show the **persona's full card** (three lines):

```
[active indicator]  Display Name          ← text-xs font-medium text-sim-text
                    Job Title             ← text-xs text-sim-text-muted
                    Team                  ← text-xs text-sim-text-faint
[unread badge]
```

DM item container: `px-3 py-2 cursor-pointer transition-colors duration-75`
- Inactive: `hover:bg-sim-surface-2`
- Active: `bg-sim-surface-2`

The job title and team come from `PersonaConfig.jobTitle` and `PersonaConfig.team` (loaded via `ScenarioContext`). The `personaId` used for the channel key is `'dm:' + persona.id`.

**Note:** Pages (sent via the `page_user` action) are NOT chat messages and do NOT appear in the Chat tab. Pages appear in the Ops Dashboard under "SENT PAGES". A trainee who pages a persona may then DM them for follow-up — that DM conversation appears here in Chat. The page itself does not.

**Right — message pane:**

Header: `px-3 py-2 border-b border-sim-border flex-shrink-0 bg-sim-surface text-xs font-semibold text-sim-text`

Messages: `flex-1 overflow-auto px-3 py-2 flex flex-col gap-3`

Empty channel (no messages yet — valid at session start before any messages arrive):
```
EmptyState title="No messages yet" message="Messages will appear here during the incident."
```
This applies to both `#channels` and `dm:` channels. No special treatment for channels vs DMs — both start empty.

Each message group (messages from same persona within 60s are grouped, no repeated header):
```
[persona/trainee — colour coded]  [T+HH:MM:SS]   ← text-xs font-semibold
[message text]                                     ← text-xs text-sim-text leading-snug
[message text 2 — grouped]
```
- Persona: `text-sim-persona`
- Trainee: `text-sim-trainee`
- Timestamp: only on first message in a group (or if > 60s since previous message from same sender)

New messages notification banner (when scrolled up and new messages arrive):
```
absolute bottom-16 left-0 right-0 flex justify-center pointer-events-none
  bg-sim-accent text-white text-xs px-3 py-1 rounded-full cursor-pointer pointer-events-auto
  ▼ 2 new messages
```

Input area: `relative border-t border-sim-border p-3 flex-shrink-0 bg-sim-surface`

The `relative` is required so the `@mention` dropdown (`absolute bottom-full`) positions relative to this container and not a distant ancestor.

```
<textarea min-h-[32px] max-h-[80px] placeholder={activeChanPlaceholder}>
[Send]  Button variant=primary size=sm
```

**Enter-to-send:** pressing Enter (without Shift) in the textarea sends the message — same as clicking Send. Shift+Enter inserts a newline. Implementation: in the `onKeyDown` handler, if `event.key === 'Enter' && !event.shiftKey`, call `event.preventDefault()` then trigger send. This is standard chat behaviour and expected by Mode 2/3 users who never reach for the mouse.

**`activeChanPlaceholder`:** derived from the active channel id:
- `#incidents` (or any `#channel`) → `"Message #incidents..."` (use the actual channel name)
- `dm:personaId` → `"Message @{persona.displayName}..."` (use the persona's display name)

This updates reactively when the active channel changes.

**Auto-expanding textarea:** on every `onChange`, set `element.style.height = 'auto'` then `element.style.height = Math.min(element.scrollHeight, 80) + 'px'`. On send, reset to `element.style.height = 'auto'` (returns to single-row height).

**@mention dropdown:**
Appears above the input when `@` is typed. Position: `absolute bottom-full left-3 right-3 mb-1`
```
bg-sim-surface border border-sim-border rounded shadow-lg z-20 overflow-y-auto max-h-[160px]
  [item] px-3 py-1.5 text-xs cursor-pointer hover:bg-sim-surface-2
         [persona display name — text-sim-text font-medium]
         [job title — text-sim-text-faint text-xs]  (on same line, separated by a bullet ·)
```
- Maximum 5 items rendered; container scrolls if more exist (`overflow-y-auto max-h-[160px]`)
- Filter: case-insensitive prefix match on persona display name
- When filter matches 0 personas: hide dropdown entirely (no "No matches" message)
- Keyboard: Up/Down moves highlight (`bg-sim-surface-2`), Enter selects highlighted item, Escape hides dropdown without inserting
- On selection: inserts `@<display-name>` at cursor position; closes dropdown

---

### 12.3 TicketingTab

**Layout:** `flex h-full`

Left: `w-56 border-r border-sim-border overflow-auto flex-shrink-0 bg-sim-surface`
Right: `flex-1 overflow-auto`

**Left — ticket list row:**
```
[SEV2]  TICKET-001                     ← Badge + id text-xs font-medium
        High error rate on payment     ← text-xs text-sim-text-muted truncate
        in_progress · T+00:00:00       ← text-xs text-sim-text-faint
```
- Row: `px-3 py-2 border-b border-sim-border-muted cursor-pointer hover:bg-sim-surface-2`
- Selected: `bg-sim-surface-2`
- Status colour: `open`=text-sim-text-muted, `in_progress`=text-sim-yellow, `resolved`=text-sim-green

**Right — ticket detail:**

No ticket selected (initial state, before the trainee clicks a row): `EmptyState title="Select a ticket" message="Click a ticket to view its details."`

The first ticket is **not** auto-selected on load — the trainee must choose. This is consistent with Email (no auto-select) and unlike Ticketing list items which are selection-driven, not notification-driven.

Header area: `px-3 py-2 border-b border-sim-border bg-sim-surface flex flex-col gap-1`
```
flex items-center gap-2:  [SEV2 badge]  TICKET-001 · [in_progress text-sim-yellow]
text-sm font-semibold:    High error rate on payment-service
```

Body: `p-3 flex flex-col gap-4`

Description section: `MarkdownRenderer content={ticket.description}`

Comments section:
```
text-xs font-semibold text-sim-text-faint uppercase tracking-wide mb-2  COMMENTS
```
Each comment:
```
flex flex-col gap-0.5
  [author + timestamp]  text-xs font-semibold  (persona=sim-persona, trainee=sim-trainee)
  [body]  text-xs text-sim-text
```

Add comment: textarea (`min-h-[48px] max-h-[96px]`) + [Comment] button (`Button variant=secondary size=sm`) below-right:
```
<textarea min-h-[48px] placeholder="Add a comment...">
<div class="flex justify-end mt-1.5">
  [Comment]  Button secondary sm
</div>
```

**No Enter-to-submit for comments.** Unlike Chat, the comment textarea is for longer-form prose. Enter inserts a newline (default textarea behaviour). Shift+Enter also inserts a newline (same). The trainee submits by clicking [Comment]. This matches the email reply box behaviour and is intentionally distinct from chat.

Actions section:
```
text-xs font-semibold text-sim-text-faint uppercase tracking-wide mb-2  ACTIONS
flex flex-wrap gap-2 items-center
  Status: [open/in_progress/resolved ▼]  (select, w-auto)
  Severity: [SEV1/SEV2/SEV3/SEV4 ▼]  (select, w-auto)
  [Mark In Progress]   ← Button secondary sm, ONLY shown when status === 'open'
  [Mark Resolved]      ← Button danger sm, ONLY shown when status === 'in_progress'
  [✓ Resolved]         ← static text-xs text-sim-green, ONLY shown when status === 'resolved'
```

**Ticket status button rules:**
- `status === 'open'`: show [Mark In Progress], hide [Mark Resolved], hide ✓ label
- `status === 'in_progress'`: hide [Mark In Progress], show [Mark Resolved], hide ✓ label
- `status === 'resolved'`: hide both buttons, show "✓ Resolved" label

**[Mark Resolved] records the action and updates the ticket — it does NOT end the simulation.** Clicking [Mark Resolved] dispatches `mark_resolved` to the audit log and sets the ticket status to resolved. The simulation continues. The trainee ends the session explicitly via the "End Simulation" button in the TabBar.

A scenario may have multiple tickets. The trainee may resolve all tickets before declaring the incident over, or may declare it over with open tickets — both are valid responses evaluated in the debrief.

---

### 12.4 OpsDashboardTab

**Layout:** `flex flex-col h-full overflow-hidden`

**Service sub-tabs:** `flex-shrink-0 flex items-center border-b border-sim-border bg-sim-surface overflow-x-auto`

The sub-tab row scrolls horizontally when there are more services than fit the viewport. `overflow-x-auto` on the container; each tab is `flex-none` (no shrinking). No wrapping. A subtle horizontal scrollbar appears (styled via §7 scrollbar rules) when the row overflows. This is acceptable — scenarios with many services are edge cases, and horizontal scroll is preferable to wrapping which would push tab content down.

Each service tab: `flex-none px-3 py-2 text-xs cursor-pointer transition-colors duration-75`
- Active: `text-sim-text border-b-2 border-sim-accent`
- Inactive: `text-sim-text-muted hover:text-sim-text`
- Firing alarm indicator: `ml-1.5 text-sim-red animate-pulse` text `●` (inline, not a badge)

**Content area:** `flex-1 overflow-auto p-3`

The content area layout (top to bottom) for the **active service** is:

```
1. Metric chart grid (charts for the active service only) — PRIMARY signal
2. ACTIVE ALARMS section (all alarms — global, not filtered to active service)
3. SENT PAGES section (only if snapshot.pages.length > 0 — global, not per-service)
```

**Rationale for ordering:** The trainee navigates to Ops primarily to read metric charts — that's the diagnostic signal. Alarms are a persistent global summary below the charts. Sent Pages are a historical record at the bottom — the trainee already wrote them and doesn't need to see them immediately. This order keeps the actionable information (charts) above the fold.

**Rationale for global alarm/page sections:** Alarms and pages are incident-wide signals. Filtering them per service would hide critical cross-service context. The trainee needs to see all active alarms and pages regardless of which service sub-tab they're viewing.

**Metric chart grid** (section 1 above):

Two-column grid: `grid grid-cols-2 gap-3`. If a service has only 1 metric, it renders in the left column; the right column is empty — this is acceptable and expected for single-metric services.

**Metric order:** rendered in the order they appear in `snapshot.metrics[service]` (insertion order of the object keys). No alphabetical sorting.

**MetricChart card:**
```typescript
interface MetricChartProps {
  metricId:           string
  service:            string
  label:              string
  unit:               string
  series:             TimeSeriesPoint[]   // full pre-generated series
  simTime:            number              // current sim time — gates visible data
  warningThreshold?:  number
  criticalThreshold?: number
}
```

Card structure:
```
bg-sim-surface border border-sim-border rounded p-0 overflow-hidden
  [header]  px-3 py-1.5 border-b border-sim-border flex items-center justify-between
    text-xs font-medium text-sim-text  "{label}"
    flex items-center gap-2:
      text-sm font-semibold  "{currentValue} {unit}"  (coloured by threshold breach)
      [CRITICAL/WARNING badge if breaching]
  [chart area]  h-[180px] w-full
    Recharts ResponsiveContainer + LineChart
```

Chart renders only `series.filter(p => p.t <= simTime)`.

"Now" indicator: `ReferenceLine x={simTime} stroke="#30363d" strokeDasharray="3 3"` — a subtle vertical dashed line at current sim time.

Recharts customisation:
```typescript
{
  // Line
  stroke: breachingCritical ? '#f85149' : breachingWarning ? '#d29922' : '#1f6feb',
  strokeWidth: 1.5,
  dot: false,
  activeDot: { r: 3, stroke: 'none' },

  // Grid
  CartesianGrid: { stroke: '#21262d', strokeDasharray: '3 3' },

  // Axes
  XAxis: { tick: { fill: '#8b949e', fontSize: 10, fontFamily: 'monospace' },
           tickFormatter: (t) => formatSimTime(t, 'T'),  // no + sign
           axisLine: { stroke: '#30363d' }, tickLine: false },
  YAxis: { tick: { fill: '#8b949e', fontSize: 10, fontFamily: 'monospace' },
           axisLine: false, tickLine: false, width: 45 },

  // Tooltip
  Tooltip: { contentStyle: { background: '#1c2128', border: '1px solid #30363d',
                              borderRadius: 4, fontSize: 10, fontFamily: 'monospace' },
             itemStyle: { color: '#e6edf3' },
             labelStyle: { color: '#8b949e' } },

  // Reference lines
  criticalThreshold: { stroke: '#f85149', strokeDasharray: '4 2', strokeWidth: 1 },
  warningThreshold:  { stroke: '#d29922', strokeDasharray: '4 2', strokeWidth: 1 },
}
```

**Before any data (simTime <= first t value):** chart renders with axes only, no line. Header value shows `—`. This is valid — the trainee sees the pre-incident baseline immediately.

Current value calculation: last point in filtered series. Threshold breach determined by comparing current value to threshold values.

**Alarm panel:** full-width, second in content area (below chart grid, above SENT PAGES), separated from charts by `mt-4 pt-4 border-t border-sim-border`. Shows **all alarms from `snapshot.alarms`** regardless of which service sub-tab is active — alarm scope is global.

```
text-xs font-semibold text-sim-text-faint uppercase tracking-wide mb-3  ACTIVE ALARMS
```

Each alarm row outer container: `flex items-start gap-3 p-3 rounded border mb-2`
- `firing`: `border-sim-red-dim bg-sim-red-dim/20`
- `acknowledged`: `border-sim-border bg-sim-surface opacity-70`
- `suppressed`: `border-sim-border-muted bg-sim-surface opacity-40`

Inner DOM structure (two-column: badge left, content right):
```
[outer flex items-start gap-3]
  [left — flex-shrink-0]
    Badge (SEV1–4, pulse=true if firing)

  [right — flex-1 flex flex-col gap-1 min-w-0]
    [first line — flex items-center gap-2 flex-wrap]
      text-xs font-medium text-sim-text  alarm-id
      text-xs [status label — coloured per status above]
      text-xs text-sim-text-muted tabular-nums ml-auto  T+HH:MM:SS

    [second line]
      text-xs text-sim-text-muted  condition text (e.g. "error_rate_p99 > 0.05")

    [third line — action buttons, only when status === 'firing']
      flex items-center gap-2 mt-1
        Button variant=ghost size=sm  "Ack"
        Button variant=ghost size=sm  "Suppress"
        Button variant=ghost size=sm  "Page User"
```
- Status label: `firing`=`text-sim-red text-xs`, `acknowledged`=`text-sim-yellow text-xs`, `suppressed`=`text-sim-text-faint text-xs`
- Action buttons: `Button variant=ghost size=sm` — not shown when suppressed/acknowledged
- **[Page User]** opens the Page User modal (see below)
- **[Ack]** dispatches two actions in order: `dispatchAction('investigate_alert', { alarmId })` then `dispatchAction('ack_page', { alarmId })`. The `investigate_alert` action is evaluation-tracked ("did the trainee examine this alarm?"). The `ack_page` action is the backend acknowledgement. **Optimistic update:** immediately set the alarm's local status to `acknowledged` without waiting for an SSE event — the action buttons disappear and the status label changes to "ack'd". The server will emit `alarm_acknowledged` confirming this; if that event arrives, the state is already correct. **Note:** `ack_page` is a legacy backend action name — it means "acknowledge alarm", not "acknowledge page".
- **[Suppress]** dispatches `dispatchAction('suppress_alarm', { alarmId })`. **Optimistic update:** immediately set the alarm's local status to `suppressed`.

**No alarms empty state:**
```
EmptyState title="No active alarms" message="Alarms will appear here when metric thresholds are breached."
```

---

**Page User Modal**

Triggered from [Page User] button. Also accessible via a standalone [+ Page User] button in the alarm panel header (for paging without a specific alarm context).

```typescript
interface PageUserModalProps {
  open:       boolean
  onClose:    () => void
  onSubmit:   (personaId: string, message: string) => void
  personas:   PersonaConfig[]  // from ScenarioContext — list of pageable personas
  alarmId?:   string           // pre-fill context if opened from an alarm row
  alarmLabel?: string          // e.g. "error_rate > 5% — fixture-service"
}
```

Modal structure:
```
Modal title: "Page User"

[body p-4 flex flex-col gap-3]
  [if alarmId present — context row]
    text-xs text-sim-text-muted bg-sim-surface-2 border border-sim-border-muted rounded px-3 py-2
    "Re: {alarmLabel}"

  [persona selector]
    text-xs font-medium text-sim-text-muted uppercase tracking-wide mb-1  "WHO TO PAGE"
    <select> — options from personas[]:
      each option: "{displayName} — {jobTitle}, {team}"
      value = persona.id

  [message textarea]
    text-xs font-medium text-sim-text-muted uppercase tracking-wide mb-1  "MESSAGE"
    <textarea min-h-[72px] placeholder="Brief description of the issue and why you are paging them...">
    text-xs text-sim-text-faint mt-1  "Be specific: include service name, current impact, and what you need."

[footer]
  [Cancel]  Button variant=ghost size=sm
  [Send Page]  Button variant=primary size=sm
    — disabled when no persona selected OR message empty
    — loading state while dispatching
```

On submit: `dispatchAction('page_user', { personaId, message })` → closes modal.

---

**SENT PAGES section** (third in content area, below ACTIVE ALARMS — see content area layout order above)

Shown whenever `snapshot.pages.length > 0`. Not shown when empty (no empty state — the section is simply absent).

```
text-xs font-semibold text-sim-text-faint uppercase tracking-wide mb-3  SENT PAGES
```

Each sent page row: `flex items-start gap-3 px-3 py-2 border-b border-sim-border-muted`

```
[left — flex-shrink-0 w-20]
  T+HH:MM:SS  text-xs text-sim-text-muted tabular-nums

[centre — flex-1 flex flex-col gap-0 min-w-0]
  persona display name  text-xs font-medium text-sim-text
  job title, team       text-xs text-sim-text-muted

[right — flex-shrink-0 max-w-[40%]]
  message text  text-xs text-sim-text truncate
```

Name and job title/team are stacked vertically in the centre column (flex-col). The message is truncated in the right column.

---

### 12.5 LogsTab

**Layout:** `flex flex-col h-full overflow-hidden`

**Filter bar:** `flex-shrink-0 flex flex-wrap gap-2 items-center px-3 py-2 border-b border-sim-border bg-sim-surface`

```
[Search logs...         ] [DEBUG][INFO][WARN][ERROR]  [All services ▼]
```

Search input: `flex-1 min-w-[120px]` — same input styling (§11.1 sm)

Level toggle buttons: `text-xs px-2 py-1 rounded border transition-colors duration-100`
- Default/inactive: `border-sim-border text-sim-text-muted bg-transparent hover:border-sim-border hover:text-sim-text`
- `DEBUG` active: `border-sim-border text-sim-text bg-sim-surface-2`
- `INFO` active: `border-sim-accent text-sim-accent bg-sim-accent/10`
- `WARN` active: `border-sim-yellow text-sim-yellow bg-sim-yellow-dim`
- `ERROR` active: `border-sim-red text-sim-red bg-sim-red-dim`
- `aria-pressed` on each

Service selector: `<select>` with "All services" default option. Populated from unique `entry.service` values in `snapshot.logs`. Sorted alphabetically.

`search_logs` action dispatched on **Enter keypress** in the search input (not on every keystroke — the filter fires live on keystroke but the audit action fires on submit/Enter). This distinguishes "user typed a search" (recorded in audit log once per submit) from "filter results updated" (live, not recorded).

**Log filter persistence:** the search text, active level toggles, and service selector state are stored in **SimShell** (the parent), not inside LogsTab. This means filter state survives tab switches — when the trainee navigates away from Logs and returns, their filter is still active. This is important for Mode 2/3 users who set up a targeted filter (`ERROR` on `payment-service`) and need to keep referencing it while switching to other tabs.

Implementation: SimShell holds `logFilterState: { query: string; levels: Set<LogLevel>; service: string }` and passes it down as props to LogsTab. LogsTab dispatches updates via a callback prop. This is the only tab where parent-held filter state is needed — other tabs don't have filters worth preserving.

**Log stream:** `flex-1 overflow-auto relative` — position relative for new-entries banner

**Log entry limit:** keep the most recent 1000 entries in the rendered list. When entries exceed 1000, remove the oldest from the top of the list. This prevents unbounded DOM growth without requiring a virtualisation library. The full `snapshot.logs` array is retained in SessionContext state — only the rendered slice is limited.

Each log entry: `flex items-start gap-2 px-3 py-1 hover:bg-sim-surface-2 border-b border-sim-border-muted`
```
[T+HH:MM:SS]  [LEVEL badge]  [service text-sim-text-muted flex-shrink-0]
[message text — second line or wraps, indented to align under message start]
```
- Timestamp: `text-xs text-sim-text-muted tabular-nums w-[82px] flex-shrink-0 pt-0.5`
- Level badge: uses `Badge` for ERROR/WARN/INFO; for DEBUG uses `<span class="text-xs text-sim-text-faint border border-sim-border-muted rounded-sm px-1 py-0.5 font-mono">DEBUG</span>`
- Service: `text-xs text-sim-text-muted flex-shrink-0`
- Message: `text-xs text-sim-text break-words` on same line after service, or wraps below with `pl-[82px]` indent on next line if message is long

**New entries banner:**
```
absolute bottom-4 left-1/2 -translate-x-1/2 z-10
bg-sim-accent text-white text-xs px-3 py-1 rounded-full cursor-pointer
flex items-center gap-1.5
▼ {count} new entr{count === 1 ? 'y' : 'ies'}
```
Shown when: user has scrolled up (not within 20px of bottom) AND new entries have arrived since last scroll-to-bottom. Clicking scrolls to bottom and hides banner.

Auto-scroll: only when user is within 20px of the bottom before the new entry arrives.

---

### 12.6 WikiTab

**Layout:** `flex h-full`

Left: `w-44 border-r border-sim-border overflow-auto flex-shrink-0 bg-sim-surface flex flex-col`
Right: `flex-1 overflow-auto`

**Left — page list:**

Search: `border-b border-sim-border flex-shrink-0`
```
<input placeholder="Search wiki..." class="w-full px-3 py-2 ...">
```
Same input styling, no border/radius (fits flush against sidebar walls).

Page list (below search): filtered by search text:
- Case-insensitive substring match on page `title` (full title searched)
- Case-insensitive substring match on first 200 characters of page `content` (not full content, to avoid performance issues with large markdown files)
- Search is debounced 300ms — filter fires 300ms after the user stops typing
- Non-matching pages are hidden (`display: none`), not removed from DOM
- When 0 pages match: show `text-xs text-sim-text-faint px-3 py-4 text-center` "No pages match"

**Right — content pane:**

No page selected: `EmptyState title="Select a page" message="Choose a wiki page from the list."`

Page selected:
```
[header]  px-3 py-2 border-b border-sim-border flex-shrink-0 bg-sim-surface
  text-sm font-semibold text-sim-text  page title
[content]  p-4
  MarkdownRenderer content={page.content}
```

`read_wiki_page` action dispatched on every page open (including re-opening same page).

---

### 12.7 CICDTab

**Layout:** `flex h-full`

Left: `w-44 border-r border-sim-border overflow-auto flex-shrink-0 bg-sim-surface`
Right: `flex-1 overflow-auto`

**Left — service list:**

Each service: `px-3 py-2 border-b border-sim-border-muted cursor-pointer text-xs`
- Inactive: `text-sim-text-muted hover:bg-sim-surface-2`
- Active: `bg-sim-surface-2 text-sim-text border-l-2 border-l-sim-accent pl-[10px]`
- Firing alarm dot: `ml-auto w-1.5 h-1.5 rounded-full bg-sim-red animate-pulse`

**Right — deployment detail:**

Header: `px-3 py-2 border-b border-sim-border bg-sim-surface flex-shrink-0`
```
text-xs font-semibold text-sim-text  "{service} deployments"
```

`view_deployment_history` action dispatched when a service is selected.

Deployment table: `w-full border-collapse text-xs`

Table header: `text-xs font-medium text-sim-text-faint uppercase tracking-wide`
```
VERSION    DEPLOYED AT       STATUS       AUTHOR    COMMIT MSG
```

Each row: `border-b border-sim-border-muted`
- Active row: `bg-sim-surface-2`
- Cells: `py-2 px-3`

Version cell:
- `active`: `text-sim-text font-medium`
- `previous`: `text-sim-text-muted`
- `rolled_back`: `text-sim-text-muted line-through` + `text-sim-orange ml-1 text-xs "(rolled back)"`

Deployed-at cell: `Timestamp` component for `t >= 0`; for `t < 0` show `formatRelativeTime(deployedAtSec)`:

```typescript
function formatRelativeTime(sec: number): string {
  // sec is negative (pre-incident)
  const abs = Math.abs(sec)
  const d   = Math.floor(abs / 86400)
  const h   = Math.floor((abs % 86400) / 3600)
  const m   = Math.floor((abs % 3600) / 60)
  if (d > 0) return `${d}d ${h}h before`
  if (h > 0) return `${h}h ${m}m before`
  return `${m}m before`
}
// t=-300  → "5m before"
// t=-3900 → "1h 5m before"
// t=-86400 → "1d 0h before"
```

Status cell:
- `active`: `●` in `text-sim-green` + "active" in `text-sim-green text-xs`
- `previous`: `●` in `text-sim-text-faint` + "previous" in `text-sim-text-faint text-xs`
- `rolled_back`: `●` in `text-sim-orange` + "rolled back" in `text-sim-orange text-xs`

Action buttons section (below table): `p-3 border-t border-sim-border`

Buttons are split into two groups separated by a visual divider so dangerous actions are spatially distinct from operational ones:

```
[RECOVERY ACTIONS group — flex flex-wrap gap-2 mb-3]
  Rollback to v{X}     variant=danger
  Roll-forward to v{X} variant=danger
  Emergency deploy     variant=danger

[divider — border-t border-sim-border-muted my-1]

[OPERATIONAL group — flex flex-wrap gap-2]
  Restart service      variant=secondary
  Scale up             variant=secondary
  Scale down           variant=secondary
  Throttle traffic     variant=secondary
  Toggle feature flag  variant=secondary  (only if hasFeatureFlags)
```

The divider is **always rendered** — Emergency deploy is always in the recovery group, so the recovery group is never empty.

**Button visibility rules — buttons are conditional based on available deployment states:**

| Button | Group | Shown when |
|---|---|---|
| Rollback to v{X} | Recovery | At least one `previous` deployment exists — one button per previous version |
| Roll-forward to v{X} | Recovery | At least one `rolled_back` deployment exists — one button per rolled-back version |
| Emergency deploy | Recovery | Always shown |
| Restart service | Operational | Always shown |
| Scale up | Operational | Always shown |
| Scale down | Operational | Always shown |
| Throttle traffic | Operational | Always shown |
| Toggle feature flag | Operational | Only shown when `scenario.engine.hasFeatureFlags === true` |

All action buttons are `Button size=sm`:
- Rollback: `variant=danger` — confirmation modal required
- Roll-forward: `variant=danger` — confirmation modal required
- Restart service: `variant=secondary` — immediate, no confirmation, no modal
- Scale up / Scale down: `variant=secondary` — immediate, no confirmation
- Throttle traffic: `variant=secondary` — opens **ThrottleTrafficModal** (see below)
- Emergency deploy: `variant=danger` — opens confirmation modal with optional notes (see below)

**ThrottleTrafficModal** (shown when Throttle Traffic button clicked):

```
Modal title: "Throttle Traffic — {service}"

[body p-4 flex flex-col gap-3]
  [percentage input]
    text-xs font-medium text-sim-text-muted uppercase tracking-wide mb-1  "THROTTLE TO (% of normal traffic)"
    <input type="number" min=0 max=100 placeholder="e.g. 50">
    text-xs text-sim-text-faint mt-1  "Enter 0–100. 0 = drop all traffic. 100 = no throttle."

[footer]
  [Cancel]  Button variant=ghost size=sm
  [Apply Throttle]  Button variant=secondary size=sm
    — disabled when input empty or value not in [0,100]
```

On submit: `dispatchAction('throttle_traffic', { service, percentage: Number(value) })` → close modal. No confirmation — throttling is a recovery action, not irreversible. The trainee can re-enter 100% to restore full traffic.

**Emergency Deploy confirmation modal** (shown when Emergency Deploy button clicked):

```
Modal title: "Emergency Deploy — {service}"
Body: "This will trigger an emergency deployment for {service}. Use only if a hotfix is ready.
      This action will be recorded in the audit log."

[body] also includes:
  [notes textarea — optional]
    text-xs font-medium text-sim-text-muted uppercase tracking-wide mb-1  "NOTES (optional)"
    <textarea min-h-[48px] placeholder="Brief description of what is being deployed...">

[footer]
  [Cancel]  Button variant=ghost size=sm
  [Deploy →]  Button variant=danger size=sm  — always enabled (notes optional)
```

On confirm: `dispatchAction('emergency_deploy', { service, notes: notesValue.trim() || undefined })` → close modal.

**FeatureFlagModal** (shown when Toggle Feature Flag button clicked):

The scenario provides a list of feature flags: each flag has an `id: string` and `label: string`. The modal lets the trainee pick a flag and toggle its state.

```
Modal title: "Toggle Feature Flag"

[body p-4 flex flex-col gap-3]
  [flag selector]
    text-xs font-medium text-sim-text-muted uppercase tracking-wide mb-1  "FLAG"
    <select> — options from scenario feature flags:
      each option: "{label}"  value = flag.id
      (pre-selects first flag)

  [current state indicator]
    text-xs text-sim-text-muted  "Current state: "
    [enabled badge or disabled text depending on last known toggle state]

  [action row flex gap-2]
    [Enable]   Button variant=secondary size=sm  — disabled if already enabled
    [Disable]  Button variant=secondary size=sm  — disabled if already disabled

[footer]
  [Cancel]  Button variant=ghost size=sm
```

On "Enable" or "Disable" click: `dispatchAction('toggle_feature_flag', { flag: selectedFlagId, enabled: true|false })` → close modal. No confirmation modal — toggling a feature flag in a sim is low-friction by design (unlike a real prod system).

Local state tracks which flags have been toggled and their last known state: `Map<flagId, boolean>`. Initial state: all flags unknown (neither button disabled). After first toggle, disable the matching direction button.

**Empty state for CI/CD when no deployments exist for a service:**
```
EmptyState title="No deployments" message="No deployment history available for this service."
```
Shown in the right pane when the selected service has an empty deployments array.

**Post-action banner:** rendered between table and action buttons after any recovery action is dispatched:
```
bg-sim-surface-2 border border-sim-accent text-sim-accent text-xs px-3 py-2 rounded
flex items-center gap-2 mb-2
▶ {bannerText} — monitoring for recovery...
```

`bannerText` depends on what was dispatched:
- `trigger_rollback`: `"Rollback to {version} triggered"`
- `trigger_roll_forward`: `"Roll-forward to {version} triggered"`
- `emergency_deploy`: `"Emergency deploy triggered"`

Dismissed: 30 sim-seconds after the banner appears with no `deployment_update` event, OR immediately on the next `deployment_update` event (the deployment table updates, confirming the action took effect). Timeout tracked via `useSimClock` simTime comparison, not real `setTimeout` (so speed=10x drains it 10x faster as expected).

---

## 13. Interaction Patterns

### 13.1 All form inputs

See §11 for complete input specification including all states.

### 13.2 Row selection

Standard pattern across Email inbox, ticket list, wiki page list, CI/CD service list:
- Hover: `hover:bg-sim-surface-2 transition-colors duration-75`
- Selected: `bg-sim-surface-2`
- Selection stored in local tab state (not in context)

**Auto-select behaviour per tab:**

| Tab | Auto-select first item on load? | Rationale |
|---|---|---|
| Email | No | Email arrival is notification-driven; trainee should consciously open each thread |
| Chat | Yes — first channel | Chat starts on `#incidents` by default; the channel always exists |
| Ticketing | No | Ticket selection is a deliberate investigation step; no ticket is "default" |
| Wiki | No | Wiki is reference material; trainee navigates intentionally |
| CI/CD | Yes — first service | The focal service is almost always first and always relevant |

"Auto-select" means the first list item is selected (highlighted + right pane populated) immediately when data first loads, without any user click.

**Auto-selection does NOT dispatch audit actions.** `view_deployment_history` is only dispatched when the trainee explicitly clicks a service in the CI/CD list. `direct_message_persona` is only dispatched when the trainee explicitly clicks a DM channel. The auto-selected initial state is a UI default, not a trainee decision — recording it would pollute the audit log.

### 13.3 Unread / notification counts

Each tab tracks its own unread count in local state. Count is reset to 0 when the tab becomes active. Never stored in SessionContext or server.

**Storage structure per tab:**

| Tab | State type | Reset trigger | Badge type |
|---|---|---|---|
| Email | `Set<string>` of unread email ids | Tab activated | numeric count |
| Chat | `Map<channelId, number>` per-channel unread count | Channel viewed (not just tab activated) | numeric sum of all channels |
| Ticketing | `number` count of new ticket_created, ticket_comment AND ticket_updated events | Tab activated | numeric count |
| Ops Dashboard | `boolean` hasNewAlarm | Tab activated | `●` dot (alarm=true on Tab def), not numeric |
| Logs | none | — | no badge |
| Wiki | none | — | no badge |
| CI/CD | `number` count of deployment_update events | Tab activated | numeric count |

**Email unread tracking:**
- On `email_received` SSE event: add `email.id` to the Set **only if `email.from !== 'trainee'`** — trainee replies must not increment the badge (the trainee wrote them; they're not "incoming")
- On Email tab activated: clear the Set → badge goes to 0
- Badge count = `Set.size`

**Chat unread tracking:**
- On `chat_message` SSE event: increment `Map.get(channel) + 1` for the affected channel
- On channel viewed (user clicks it): `Map.set(channel, 0)` for that channel
- Tab badge = sum of all Map values
- Per-channel badge in sidebar = `Map.get(channel)` for each channel

**Ops Dashboard alarm tracking:**
- On `alarm_fired` SSE event: set `hasNewAlarm = true`
- On Ops tab activated: set `hasNewAlarm = false`
- Tab shows `●` indicator when `hasNewAlarm === true` (not a number — matches §8.11 `alarm?:boolean`)

### 13.4 Confirmation modal pattern

Used for: `trigger_rollback`, `trigger_roll_forward`, `emergency_deploy`, **and "End Simulation"**.

**Note:** `mark_resolved` (ticket) does NOT trigger a confirmation modal — it is a routine ticket status update that does NOT end the session. Only the "End Simulation" button ends the session.

```typescript
interface ConfirmAction {
  title:     string   // "Confirm Rollback" | "End Simulation?"
  body:      string   // "Roll back {service} to {version}?" | "This will end the simulation and generate your debrief."
  confirm:   string   // "Rollback →" | "End Simulation →"
  onConfirm: () => void
}
```

**"End Simulation" confirmation modal:**
```
Modal title: "End Simulation?"
Body: "This will stop the incident simulation and generate your debrief report.
      You won't be able to take further actions."
Footer: [Cancel]  [End Simulation →]  (danger variant)
```
On confirm: `POST /api/sessions/:id/resolve` → wait for debrief → navigate to debrief screen.

Local state `confirmAction: ConfirmAction | null`. When not null, `<Modal>` is rendered. On confirm: call `onConfirm()`, set to null. On cancel/close: set to null only.

### 13.5 Auto-scroll in message lists

Applies to: Chat message pane, Log stream, Ticket comment list.

```typescript
// Implementation pattern — use useLayoutEffect to check scroll position
// BEFORE the DOM update is painted, then scroll after if needed.

const containerRef = useRef<HTMLDivElement>(null)
const shouldAutoScrollRef = useRef(true)

// Check scroll position before each render (synchronously after DOM update but before paint)
useLayoutEffect(() => {
  const el = containerRef.current
  if (!el) return
  // Recheck: are we still at the bottom after the DOM update?
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20
  if (shouldAutoScrollRef.current && atBottom) {
    el.scrollTop = el.scrollHeight
  }
})

// Track user scroll position
function onScroll(e: React.UIEvent<HTMLDivElement>) {
  const el = e.currentTarget
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20
  shouldAutoScrollRef.current = atBottom
  setShowNewEntries(!atBottom && hasUnviewedEntries)
}
```

**Rule:** only auto-scroll if the user was at the bottom (within 20px) immediately before the new content was added. If the user has scrolled up at all, never auto-scroll — show the "N new entries" banner instead.

### 13.6 Disabled state during inactive session

When `session.status !== 'active'` (resolved or expired), all form inputs and action buttons are disabled. The tab content is still visible (read-only). `useSession().dispatchAction()` is a no-op when session is inactive.

---

### 13.7 Action dispatch semantics

All tab interactions that have audit significance call `dispatchAction(type, params)`. The full payload shapes are:

```typescript
// Navigation / observation (no server-side consequence; recorded in audit log only)
dispatchAction('open_tab',               { tab: TabId })
dispatchAction('view_metric',            { metricId: string; service: string })
dispatchAction('view_deployment_history',{ service: string })
dispatchAction('read_wiki_page',         { pageTitle: string })
dispatchAction('search_logs',            { query: string })

// Ticket actions
dispatchAction('update_ticket',          { ticketId: string; changes: Partial<{ status: TicketStatus; severity: string }> })
dispatchAction('add_ticket_comment',     { ticketId: string; body: string })
dispatchAction('mark_resolved',          { ticketId: string })

// Alarm actions
dispatchAction('investigate_alert',  { alarmId: string })   // dispatched by [Ack] (first, evaluation-tracked)
dispatchAction('ack_page',           { alarmId: string })   // dispatched by [Ack] (second, silences alarm)
dispatchAction('suppress_alarm',     { alarmId: string })

// Paging
dispatchAction('page_user',             { personaId: string; message: string })

// CICD actions
dispatchAction('trigger_rollback',      { service: string; version: string })
dispatchAction('trigger_roll_forward',  { service: string; version: string })
dispatchAction('restart_service',       { service: string })
dispatchAction('scale_cluster',         { service: string; direction: 'up' | 'down' })
dispatchAction('throttle_traffic',      { service: string; percentage: number })
dispatchAction('emergency_deploy',      { service: string; notes?: string })
dispatchAction('toggle_feature_flag',   { flag: string; enabled: boolean })

```

**`open_tab`:** Dispatched on mount of each tab component. Records which tab the trainee opened and when. This is an audit trail entry only — it has no mechanical effect. One `open_tab` per tab activation (including re-visiting).

**`direct_message_persona`:** Dispatched the **first time** a DM channel is opened for a given persona in a session. Subsequent re-opens of the same DM channel do NOT re-dispatch. This records the initial "reach out" decision. Implementation: track a `Set<personaId>` of DM channels already dispatched; check before dispatching.
```typescript
dispatchAction('direct_message_persona', { personaId: string })
```

**`view_metric`:** Dispatched once per metric per session when a MetricChart is first hovered (mouse enter on chart area). Tracks which metrics the trainee examined. Not re-dispatched on subsequent hovers of the same metric.
```typescript
dispatchAction('view_metric', { metricId: string; service: string })
```

**`mark_resolved` dual-dispatch:** When the trainee clicks [Mark Resolved] on a ticket:
1. `dispatchAction('mark_resolved', { ticketId })` — evaluation-tracked action (records the resolution decision)
2. `dispatchAction('update_ticket', { ticketId, changes: { status: 'resolved' } })` — updates ticket display state

Both are dispatched in order. The server processes `mark_resolved` as an evaluation-relevant action and `update_ticket` as a state change. The UI updates ticket status to `resolved` optimistically (do not wait for SSE confirmation) to avoid flicker.

**`update_ticket`:** Merges `changes` into the local ticket state immediately (optimistic update). Used for all ticket status and severity changes via the select dropdowns, and for the status update step of `mark_resolved`.

---

## 14. Accessibility

- **Focus rings:** every interactive element has `focus-visible:ring-2 focus-visible:ring-sim-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sim-bg` or equivalent. The global `:focus-visible` style in `index.css` covers elements that don't have explicit focus styles.
- **Keyboard navigation in TabBar:** `role="tablist"` on TabBar, `role="tab"` + `aria-selected` on each tab, `aria-controls="tabpanel-{id}"` pointing to the tab content, `role="tabpanel"` + `aria-labelledby` on content. Left/Right arrow keys navigate tabs (activates immediately). Home/End go to first/last tab.
- **Modals:** `role="dialog"` `aria-modal="true"` `aria-labelledby="modal-title"`. Focus trap per §8.4. Escape closes.
- **Log level toggles:** `role="button"` `aria-pressed={active}` on each toggle.
- **Icon-only buttons (close button ×, coach panel toggle):** `aria-label` required.
- **Alarm badge:** `aria-live="polite"` on the unread count span so screen readers announce new counts.
- **Colour:** severity is never communicated by colour alone — the label (SEV1, SEV2, ERROR, WARN, etc.) is always present as text.
- **Minimum touch target:** `min-w-[2rem] min-h-[2rem]` on all interactive elements.
- **Tabular numbers:** `tabular-nums` on all numeric displays (timestamps, counts) to prevent layout shift.

---

## 15. Testing Strategy

### 15.1 Philosophy

Every component, every state transition, every SSE event handler is tested. The test suite is the confidence mechanism — manual testing of a real-time SSE-driven UI is too slow and unreliable.

### 15.2 Test tooling

| Tool | Role |
|---|---|
| Vitest | Test runner |
| React Testing Library | Component rendering and querying |
| `@testing-library/user-event` | Simulating user interactions (type, click, keyboard) |
| `@testing-library/jest-dom` | DOM matchers (`toBeInTheDocument`, `toHaveClass`, etc.) |
| MSW (`msw`) | Intercepting `fetch` calls in tests — no real HTTP |
| Vitest snapshot tests | Visual regression prevention on primitives |
| `renderHook` from RTL | Testing hooks in isolation |

No Playwright/Cypress. All tests run in jsdom via Vitest.

### 15.3 `renderWithProviders` contract

Expanded from Phase 1 stub to wrap all contexts:

```typescript
interface RenderOptions {
  snapshot?:    Partial<SessionSnapshot>   // seed SessionContext state
  sessionId?:   string                     // default 'test-session-id'
  scenarioId?:  string                     // default '_fixture'
  wikiPages?:   Array<{ title: string; content: string }>
  sse?:         MockSSEConnection          // override SSE mock; auto-created if omitted
  onExpired?:   () => void
  onDebrief?:   () => void
  onError?:     (message: string) => void  // default: vi.fn() — captures API failure calls
}
```

**`getSnapshot` is deliberately NOT returned.** Tests must assert on DOM output (text content, element presence, aria attributes) — not on internal React state. Internal state is an implementation detail.

Usage pattern:
```typescript
const { sse, getByText } = renderWithProviders(<ChatTab />, {
  snapshot: buildTestSnapshot({ chatChannels: { '#incidents': [buildChatMessage()] } })
})
// Push a new SSE event and assert DOM updates:
sse.emit({ type: 'chat_message', channel: '#incidents', message: buildChatMessage({ text: 'hello' }) })
expect(getByText('hello')).toBeInTheDocument()
```

### 15.4 MSW setup

```typescript
// src/testutil/msw-handlers.ts
import { http, HttpResponse } from 'msw'

export const defaultHandlers = [
  http.get('/api/scenarios', () =>
    HttpResponse.json([buildScenarioSummary()])
  ),
  http.get('/api/scenarios/:id', () =>
    HttpResponse.json(buildFullScenario())
  ),
  http.post('/api/sessions', () =>
    HttpResponse.json({ sessionId: 'test-session-id' }, { status: 201 })
  ),
  http.post('/api/sessions/:id/actions', () =>
    new HttpResponse(null, { status: 204 })
  ),
  http.post('/api/sessions/:id/chat', () =>
    new HttpResponse(null, { status: 204 })
  ),
  http.post('/api/sessions/:id/email/reply', () =>
    new HttpResponse(null, { status: 204 })
  ),
  http.post('/api/sessions/:id/speed', () =>
    new HttpResponse(null, { status: 204 })
  ),
  http.post('/api/sessions/:id/resolve', () =>
    HttpResponse.json({ status: 'resolving' }, { status: 202 })
  ),
  http.get('/api/sessions/:id/debrief', () =>
    HttpResponse.json(buildDebriefPayload())
  ),
]
```

**Testutil builders required in `client/src/testutil/index.ts`** (add to existing builders):

```typescript
// Scenario summary (for GET /api/scenarios list)
export function buildScenarioSummary(
  overrides: Partial<ScenarioSummary> = {}
): ScenarioSummary {
  return {
    id:          '_fixture',
    title:       'Fixture Scenario',
    description: 'A minimal test scenario.',
    serviceType: 'api',
    difficulty:  'medium',
    tags:        ['fixture'],
    ...overrides,
  }
}

// Full scenario config (for GET /api/scenarios/:id)
export function buildFullScenario(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id:          '_fixture',
    title:       'Fixture Scenario',
    description: 'A minimal test scenario.',
    serviceType: 'api',
    difficulty:  'medium',
    tags:        ['fixture'],
    topology:    { focalService: 'fixture-service', upstream: [], downstream: [] },
    personas:    [{
      id:           'fixture-persona',
      displayName:  'Fixture Persona',
      jobTitle:     'Senior SRE',
      team:         'Platform',
      systemPrompt: 'test',
    }],
    wikiPages:      [{ title: 'Architecture', content: '# Architecture\n\nContent here.' }],
    cicd:           { pipelines: [] },
    featureFlags:   [],
    evaluation:     { rootCause: 'test', relevantActions: [], redHerrings: [], debriefContext: '' },
    engine: {
      defaultTab:              'email',
      timelineDurationSeconds: 600,
      hasFeatureFlags:         false,
    },
    ...overrides,
  }
}

// Debrief payload (for GET /api/sessions/:id/debrief)
export function buildDebriefPayload(
  overrides: Partial<DebriefPayload> = {}
): DebriefPayload {
  return {
    narrative:         '',
    evaluationState:   { relevantActionsTaken: [], redHerringsTaken: [], resolved: false },
    auditLog:          [],
    eventLog:          [],   // SimEventLogEntry[] — added by backend epic
    resolvedAtSimTime: 0,
    ...overrides,
  }
}
```

MSW server started in `vitest.setup.ts`:
```typescript
import { setupServer } from 'msw/node'
import { defaultHandlers } from './msw-handlers'

export const server = setupServer(...defaultHandlers)
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

Individual tests override handlers using `server.use(...)`.

### 15.5 Required test cases per component

**SessionContext — all SSE event types:**
```
session_snapshot  → snapshot state populated, connected=true, simTime/speed/paused extracted;
                    snapshot.pages populated
chat_message      → message appended to correct channel, other channels unaffected
email_received    → appended to emails array, other fields unchanged
log_entry         → appended to logs array
alarm_fired       → appended to alarms array
alarm_silenced       → correct alarm status set to 'suppressed', others unchanged
alarm_acknowledged   → correct alarm status set to 'acknowledged', others unchanged
ticket_created    → appended to tickets array
ticket_updated    → changes MERGED into ticket (not replaced), other tickets unchanged
ticket_comment    → appended to ticketComments[ticketId], other ticket comments unchanged
deployment_update → updates correct service deployments, others unchanged
page_sent         → PageAlert appended to snapshot.pages
sim_time          → simTime/speed/paused updated on SessionState, snapshot NOT mutated
session_expired   → onExpired callback invoked
debrief_ready     → onDebriefReady callback invoked
coach_message     → appended to coachMessages
error             → console.error called with code and message; state NOT changed
metric_update     → no crash, no state change (Phase 2 event, ignored in Phase 7)
```

**useSSE:**
```
connected=true after EventSource receives first message
calls onEvent with parsed SimEvent for each 'data:' line
ignores ':heartbeat' comment lines
ignores malformed JSON without crashing
reconnecting=true when EventSource onerror fires
reconnection backoff: 1s → 2s → 4s → 8s → max 30s
backoff resets to 1s after successful reconnect
cleanup: EventSource.close() called on unmount
cleanup: pending reconnect timeout cleared on unmount
```

**useSimClock:**
```
returns display='T+00:00:00' at simTime=0
returns display='T+00:03:42' at simTime=222
returns display='T-00:05:00' at simTime=-300 (pre-incident)
paused=true reflected in return value
speed=5 reflected in return value
interpolates between server updates using requestAnimationFrame
interpolation respects speed multiplier
interpolation stops when paused=true
```

**Button:**
```
renders with correct text
variant=primary has primary background
variant=danger has danger background
loading=true shows Spinner and disables click
disabled=true prevents onClick
onClick called on click when enabled
type=button is default (not submit)
aria-busy=true when loading
```

**Badge:**
```
renders label text
variant=sev1 has sim-red text
variant=sev2 has sim-orange text
variant=sev3 has sim-yellow text
variant=sev4 has sim-info text
pulse=true adds animate-pulse class
```

**Modal:**
```
not rendered when open=false
rendered when open=true
title displayed in header
Escape key calls onClose
overlay click calls onClose
× button calls onClose
focus moves to first focusable element on open
Tab key cycles through focusable elements without escaping modal
Shift+Tab cycles backward
body scroll locked when open
```

**Timestamp:**
```
simTime=0 → 'T+00:00:00'
simTime=222 → 'T+00:03:42'
simTime=3662 → 'T+01:01:02'
simTime=-300 → 'T-00:05:00'
simTime=90061 → 'T+25:01:01' (HH can exceed 23)
custom prefix respected
```

**TabBar:**
```
renders all tab labels
active tab has active styling
inactive tabs have inactive styling
clicking inactive tab calls onTabChange with correct id
badge count rendered when > 0
badge not rendered when 0 or undefined
alarm dot rendered when alarm=true
End Simulation button calls onResolve on click
End Simulation button disabled when resolveDisabled=true
Left arrow key activates previous tab
Right arrow key activates next tab
Home key activates first tab
End key activates last tab
```

**PageUserModal:**
```
not rendered when open=false
renders persona options from props
if single persona, it is pre-selected
send disabled when no persona selected
send disabled when message < 10 characters
send enabled when persona selected and message valid
submit calls onSubmit with personaId and message
closes after submit
alarm context line shown when alarmId provided
alarm context line not shown when alarmId omitted
focus lands on message textarea on open
```

**ScenarioPicker:**
```
shows loading spinner while fetching
renders scenario cards after fetch
scenario title, meta, description, tags rendered
Start button calls onStart with correct scenarioId
error state shown when fetch fails
Start button shows loading while session being created
session creation failure shows error state in picker
```

**SimShell:**
```
connecting spinner shown before first session_snapshot
tab content shown after first session_snapshot received
reconnection banner shown when reconnecting=true, hidden when false
resolving overlay shown over tab content when resolving=true
resolving overlay hidden when resolving=false
End Simulation button disabled when resolving=true
open_tab dispatched on defaultTab mount
```

**EmailTab:**
```
empty state shown when emails=[]
renders inbox list grouped by thread
unread indicator shown for unread emails
clicking email shows thread view
thread view shows all messages in thread in order
persona messages use sim-persona colour
trainee messages use sim-trainee colour
reply textarea submits replyEmail with threadId and body
reply appears immediately in thread (optimistic — does not wait for SSE)
SSE email_received echo of trainee reply is suppressed (same body within 5 sim-seconds)
send button disabled when textarea empty
send button disabled when session inactive
open_tab action dispatched on mount
unread count in badge matches unread emails
SSE email_received event → new email appears in inbox
```

**ChatTab:**
```
channel list rendered from snapshot.chatChannels keys
# channels shown in CHANNELS section
dm: channels shown in DMS section
clicking channel shows messages in that channel
messages rendered in chronological order
persona messages use sim-persona, trainee use sim-trainee
message send calls postChatMessage with channel and text
message send disabled when text empty
Enter key sends message (without Shift)
Shift+Enter inserts newline instead of sending
@ character in input shows mention dropdown
dropdown filters by persona name prefix
pressing Down in dropdown moves highlight
pressing Enter in dropdown inserts mention and closes dropdown
pressing Escape in dropdown closes without inserting
direct_message_persona action dispatched on first DM open
direct_message_persona NOT dispatched on subsequent DM re-opens
empty channel state shown when channel has no messages
new message auto-scrolls when at bottom
new-messages banner shown when scrolled up and new messages arrive
clicking banner scrolls to bottom
```

**TicketingTab:**
```
ticket list rendered from snapshot.tickets
empty list state shown when tickets=[]
no-ticket-selected empty state shown on initial load
clicking ticket shows detail view
description rendered via MarkdownRenderer
comments rendered in order
add comment calls dispatchAction add_ticket_comment
Mark In Progress shown when status=open, hidden otherwise
Mark Resolved shown when status=in_progress, hidden otherwise
Mark In Progress calls update_ticket with status=in_progress
Mark Resolved calls mark_resolved AND update_ticket (does NOT call resolve())
status/severity selects call update_ticket with correct changes
SSE ticket_comment event → new comment appears
SSE ticket_updated event → ticket fields update without page reload
```

**OpsDashboardTab:**
```
service sub-tabs rendered for each service in snapshot.metrics
clicking service sub-tab shows that service's charts
MetricChart: only renders data points where t <= simTime
MetricChart: at simTime=0, only t<=0 data visible
MetricChart: threshold reference lines rendered when thresholds defined
MetricChart: line colour changes based on threshold breach
current value displayed in chart header
alarm panel renders alarms from snapshot.alarms
firing alarm badge has animate-pulse
acknowledged alarm has opacity-70 and no action buttons
suppressed alarm has opacity-40 and no action buttons
no alarms → empty state rendered
Ack click dispatches investigate_alert then ack_page for correct alarmId
Ack click immediately updates alarm row to acknowledged state (action buttons gone, label shows "ack'd")
suppress_alarm dispatched on Suppress click
Suppress click immediately updates alarm row to suppressed state (action buttons gone, opacity reduced)
Page User button opens PageUserModal
PageUserModal: persona selector populated from ScenarioContext.personas
PageUserModal: send disabled when no persona or message empty
PageUserModal: submit dispatches page_user with personaId and message
sent pages section shown when snapshot.pages.length > 0
sent pages section hidden when snapshot.pages is empty
SSE page_sent event → new page appears in sent pages section
view_metric dispatched when chart is interacted with
open_tab dispatched on mount
SSE alarm_fired event → new alarm appears in panel
SSE alarm_silenced event → alarm status updated
```

**LogsTab:**
```
log entries rendered from snapshot.logs
entries in chronological order
text search filters by message content
text search filters by service name
level toggle DEBUG: filters to debug only when active
level toggle ERROR: filters to error only when active
service selector filters to selected service
clear filter shows all entries
ERROR level has sim-red badge
WARN level has sim-yellow badge
INFO level has sim-info badge
DEBUG level has default/faint badge
auto-scroll when user at bottom and new entry arrives
no auto-scroll when user scrolled up
new-entry banner shown when scrolled up and entries arrive
clicking banner scrolls to bottom
search_logs action dispatched on Enter keypress in search input (not on every keystroke)
open_tab dispatched on mount
```

**WikiTab:**
```
page list rendered from ScenarioContext.wikiPages
empty state when no pages
search filters by page title (case-insensitive)
search filters by page content
clicking page shows MarkdownRenderer with page content
active page highlighted with left accent bar
read_wiki_page action dispatched on page open
open_tab dispatched on mount
```

**CICDTab:**
```
service list rendered from snapshot.deployments keys
clicking service shows deployment table for that service
active deployment row highlighted
active deployment shows sim-green dot
previous deployment shows muted dot
rolled_back deployment shows strikethrough and sim-orange text
deployment timestamps: negative t shows relative text, positive shows Timestamp
rollback button shows confirmation modal before dispatching
confirming rollback dispatches trigger_rollback with service and version
cancelling rollback modal does not dispatch
post-action banner shown after rollback dispatched
post-action banner dismisses after 30 sim-seconds (via simTime comparison)
restart_service button dispatches restart_service
toggle_feature_flag button not shown when no feature flags configured
view_deployment_history dispatched when service selected
open_tab dispatched on mount
```

**DebriefScreen:**
```
loaded state shown when debrief data available
scenario title in header
New Scenario button calls onBack
Run Again button calls onRunAgain with correct scenarioId
Phase 7 narrative placeholder visible in left column
incident timeline renders auditLog entries with ▶ icon
incident timeline renders eventLog entries with appropriate icons
timeline sorted by simTime ascending
relevant action entry shows ✓ badge
red herring entry shows ✗ badge
why text shown below action name for evaluated entries
evaluation panel shows relevant actions taken (✓ with why)
evaluation panel shows red herrings taken (✗ with why)
evaluation panel shows missed relevant actions (○ with why)
resolved=true shows "✓ Incident marked resolved"
resolved=false shows "○ Incident not explicitly resolved"
stats panel shows resolvedAtSimTime
stats panel shows action count
```

**ErrorToast:**
```
not rendered when message is null
rendered with message text when message is non-null
dismiss button calls onDismiss
rendered in a portal (not inside the component tree)
```

**ThrottleTrafficModal:**
```
not rendered when open=false
input accepts numeric values
Apply Throttle disabled when input is empty
Apply Throttle disabled when value < 0
Apply Throttle disabled when value > 100
Apply Throttle enabled when value is 0–100
submit calls onSubmit with service and correct percentage as number
cancel calls onClose without dispatching
```

**FeatureFlagModal:**
```
not rendered when open=false
renders all feature flags from scenario as select options
first flag pre-selected on open
Enable button disabled when flag already enabled
Disable button disabled when flag already disabled
Enable dispatches toggle_feature_flag with enabled=true and closes modal
Disable dispatches toggle_feature_flag with enabled=false and closes modal
state tracks toggled flags — re-opening modal shows last known state
cancel closes without dispatching
```

### 15.6 Test naming conventions

```typescript
describe('ComponentName', () => {
  describe('rendering', () => {
    it('renders empty state when no data')
    it('renders list items from snapshot data')
    it('renders loading state while fetching')
  })
  describe('user interactions', () => {
    it('clicking a row selects it')
    it('submitting form dispatches correct action with correct params')
  })
  describe('SSE event handling', () => {
    it('event type X appends to the correct list')
    it('badge count increments on new event')
  })
  describe('accessibility', () => {
    it('has correct aria roles')
    it('keyboard navigation works')
  })
})
```

### 15.7 What NOT to test

- Tailwind class strings (change constantly with refactoring, zero signal)
- Exact pixel measurements or computed styles
- Internal component state (test behaviour, not implementation)
- Recharts rendering internals (third-party library)

---

## 16. File Structure

```
client/
  src/
    index.css                      # global styles: body, scrollbar, sim-prose
    main.tsx                       # React entry point
    App.tsx                        # screen state machine: picker → sim → debrief

    context/
      SessionContext.tsx           # SSE event → React state; all action dispatch methods
      ScenarioContext.tsx          # scenario metadata: title, wiki pages, topology, engine config

    hooks/
      useSSE.ts                    # EventSource lifecycle, reconnection backoff
      useSimClock.ts               # interpolated sim clock display

    components/
      # Primitives
      Button.tsx
      Badge.tsx
      Panel.tsx
      Modal.tsx
      Spinner.tsx
      EmptyState.tsx
      MarkdownRenderer.tsx
      Timestamp.tsx

      # Shell
      Topbar.tsx
      TabBar.tsx
      SpeedControl.tsx
      SimShell.tsx
      CoachPanelShell.tsx
      DebriefScreen.tsx
      ScenarioPicker.tsx
      PageUserModal.tsx           # standalone modal for page_user action
      ErrorToast.tsx              # transient API failure notification (§19.1)

      # Tabs (Phase 8)
      tabs/
        EmailTab.tsx
        ChatTab.tsx
        TicketingTab.tsx
        OpsDashboardTab.tsx
        MetricChart.tsx             # extracted — standalone chart card
        LogsTab.tsx
        WikiTab.tsx
        CICDTab.tsx
        FeatureFlagModal.tsx        # inline to CICDTab logically; extracted for testability
        ThrottleTrafficModal.tsx    # inline to CICDTab logically; extracted for testability

    testutil/
      index.ts                     # expanded renderWithProviders, all builders
      setup.ts                     # vitest setup, MSW server
      msw-handlers.ts              # default MSW handlers for all API routes

  __tests__/
    context/
      SessionContext.test.tsx
      ScenarioContext.test.tsx
    hooks/
      useSSE.test.ts
      useSimClock.test.ts
    components/
      Button.test.tsx
      Badge.test.tsx
      Panel.test.tsx
      Modal.test.tsx
      Spinner.test.tsx
      EmptyState.test.tsx
      MarkdownRenderer.test.tsx
      Timestamp.test.tsx
      SpeedControl.test.tsx
      TabBar.test.tsx
      ScenarioPicker.test.tsx
      SimShell.test.tsx
      CoachPanelShell.test.tsx
      DebriefScreen.test.tsx
      PageUserModal.test.tsx
    tabs/
      EmailTab.test.tsx
      ChatTab.test.tsx
      TicketingTab.test.tsx
      OpsDashboardTab.test.tsx
      LogsTab.test.tsx
      WikiTab.test.tsx
      CICDTab.test.tsx
    testutil/
      testutil.test.ts             # tests for testutil itself (already exists)
```

---

## 17. Dependencies

### Production dependencies to add

```json
{
  "marked":     "^12.0.0",   // markdown parsing
  "dompurify":  "^3.1.0"    // XSS sanitisation
}
```

### Dev dependencies to add

```json
{
  "@types/dompurify":   "^3.0.0",
  "msw":                "^2.2.0",   // fetch mocking in tests
  "tailwindcss":        "^3.4.0",   // CSS framework
  "postcss":            "^8.4.0",   // required by tailwind
  "autoprefixer":       "^10.4.0"   // required by tailwind
}
```

### Install commands

```bash
# Production
npm install marked dompurify --workspace=client

# Dev
npm install --save-dev @types/dompurify msw tailwindcss postcss autoprefixer --workspace=client
```

---

## 18. Configuration Files Required Before Implementation

### 18.1 `client/tailwind.config.js`

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    './__tests__/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'sim-bg':           '#0d1117',
        'sim-surface':      '#161b22',
        'sim-surface-2':    '#1c2128',
        'sim-border':       '#30363d',
        'sim-border-muted': '#21262d',
        'sim-text':         '#e6edf3',
        'sim-text-muted':   '#8b949e',
        'sim-text-faint':   '#484f58',
        'sim-accent':       '#1f6feb',
        'sim-accent-dim':   '#0d419d',
        'sim-green':        '#3fb950',
        'sim-green-dim':    '#196127',
        'sim-yellow':       '#d29922',
        'sim-yellow-dim':   '#4d3900',
        'sim-orange':       '#db6d28',
        'sim-orange-dim':   '#5a2000',
        'sim-red':          '#f85149',
        'sim-red-dim':      '#5d0f0d',
        'sim-info':         '#0099ff',
        'sim-info-dim':     '#003366',
        'sim-trainee':      '#79c0ff',
        'sim-persona':      '#d2a8ff',
      },
      fontFamily: {
        mono: [
          'JetBrains Mono',
          'Fira Code',
          'Cascadia Code',
          'Consolas',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
}
```

### 18.2 `client/postcss.config.js`

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

### 18.3 `client/vite.config.ts` — add CSS config

Vite picks up `postcss.config.js` automatically. No additional configuration needed beyond confirming `@vitejs/plugin-react` is present (already in `package.json`).

### 18.4 `client/index.html`

```html
<!DOCTYPE html>
<html lang="en" class="h-full">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>On-Call Training Simulator</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
</head>
<body class="h-full">
  <div id="root" class="h-full"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

`JetBrains Mono` loaded from Google Fonts as the primary typeface. The local fallback chain (`Fira Code → Cascadia Code → Consolas → monospace`) ensures text renders correctly even if the font fails to load.

---

## 19. Error Handling and Recovery

### 19.1 API call failures

All `dispatchAction`, `postChatMessage`, and `replyEmail` calls are **fire-and-forget** — the UI does not wait for confirmation before updating local state (optimistic updates). If the server returns a non-2xx response:

- Log `console.error` with the action type and status code
- Show a transient error toast (see §8.17): `fixed bottom-4 right-4 z-[60]`
  - Content: `"Action failed — {actionType} could not be submitted. Try again."`
  - Auto-dismisses after 4 real seconds
  - At most one toast visible at a time (new failure replaces the current one)
- **Do not roll back optimistic state updates** — the sim continues. The trainee may retry if they choose.

`resolveSession` (End Simulation) is the only exception: if `POST /resolve` returns non-202, show the toast and keep the confirmation modal open so the trainee can retry.

Scenario fetch failure (GET `/api/scenarios/:id`) during Picker → Sim transition: stop the loading state, show `EmptyState title="Failed to load scenario" message="Could not start the session. Please try again."` in the picker, do not navigate to sim.

### 19.2 Page refresh mid-session

The app has no URL-based session recovery. If the trainee refreshes the browser mid-session:

- App state is lost (all local React state, unread counts, selected tab, etc.)
- `App.tsx` starts on `picker` screen — the trainee is returned to scenario selection
- The server-side session remains alive (TTL has not expired)
- The trainee can **not** rejoin an in-progress session from the picker — there is no "Resume" flow

This is intentional: the simulation is a timed, linear exercise. Refreshing is equivalent to dropping the call. No partial-session recovery is implemented. The picker does not show in-progress sessions.

If a session was previously started and not ended, the next session start creates a new independent session. The old session expires naturally via server TTL.

### 19.3 Session expiry overlay

Specified in §10. The overlay prompts the user to return to the picker and requires a button click — no auto-redirect.

---

## 20. No Open Questions

All design decisions are resolved. Any deviation from this spec requires explicit approval before implementation begins.
