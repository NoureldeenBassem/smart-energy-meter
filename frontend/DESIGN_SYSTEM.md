# Wattwise — Design System (Phase 3)

> **Goal**: Codify the visual language — tokens, components, charts, status states, icons, spacing, radius, shadows — for the mobile-first glassmorphism redesign. All tokens extend the existing `globals.css` foundation; no breaking changes to the CSS architecture.

---

## 1. Colour Tokens (Extended from globals.css)

### Atmosphere (Background Field)
| Token | Value | Use |
|-------|-------|-----|
| `--sky-1` | `#d7e0ec` | Lightest gradient stop (top) |
| `--sky-2` | `#b9c8dc` | Base body background |
| `--sky-3` | `#9dafc8` | Mid gradient stop |
| `--sky-4` | `#8698b4` | Deepest gradient stop (bottom) |

**Body gradient** (replaces flat `--sky-2`):
```css
body {
  background: linear-gradient(165deg, var(--sky-1) 0%, var(--sky-2) 45%, var(--sky-3) 100%);
}
```

### Glass Surfaces
| Token | Value | Use |
|-------|-------|-----|
| `--glass` | `rgba(255,255,255,0.66)` | Default card |
| `--glass-strong` | `rgba(255,255,255,0.80)` | Nav bar, headers |
| `--glass-soft` | `rgba(255,255,255,0.34)` | Inactive states, subtle fills |
| `--glass-line` | `rgba(255,255,255,0.66)` | Border |
| `--glass-shadow` | `0 2px 8px rgba(30,41,59,0.06), 0 18px 40px -20px rgba(30,41,59,0.34)` | Elevation |

### Charcoal Anchor
| Token | Value | Use |
|-------|-------|-----|
| `--ink-panel` | `#2b2f37` | Dark panel fill |
| `--ink-panel-2` | `#363b44` | Dark panel gradient top |
| `--ink-panel-line` | `rgba(255,255,255,0.10)` | Dark panel border |

### Type
| Token | Value | Use |
|-------|-------|-----|
| `--ink` | `#21262d` | Primary text |
| `--ink-2` | `#3d4650` | Secondary text |
| `--ink-3` | `#5c6673` | Tertiary / labels |
| `--on-dark` | `#f1f4f8` | Text on charcoal |
| `--on-dark-2` | `#9aa5b4` | Muted text on charcoal |

### Accent (Fill-Only — Never Text on White)
| Token | Value | Use |
|-------|-------|-----|
| `--accent` | `#e3ec4a` | Gauge arcs, needles, highlights, active nav bg |
| `--accent-2` | `#cbd42f` | Active border, hover states |
| `--accent-ink` | `#5c6400` | Accent-coloured **labels** on light glass (4.5:1) |
| `--accent-wash` | `rgba(227,236,74,0.22)` | Soft accent background |

### Status
| Token | Value | Use |
|-------|-------|-----|
| `--warn` | `#b32a2f` | Critical alert, overshoot, shed |
| `--warn-wash` | `rgba(179,42,47,0.12)` | Warning background |
| `--ok` | `#2b7a52` | Success, under-target |
| `--amber` | `#f5b13a` | Stale / caution (from PowerGauge) |
| `--amber-wash` | `rgba(245,177,58,0.18)` | Caution background |

---

## 2. Typography Scale

| Role | Size | Weight | Tracking | Component |
|------|------|--------|----------|-----------|
| **Hero number** | `text-[56px]` | 700 | `-0.03em` | Allowed kWh (Budget) |
| **Display** | `text-[34px]` | 700 | `-0.02em` | Predicted bill (ForecastGauge) |
| **H1** | `text-[28px]` | 700 | `-0.02em` | Page titles |
| **H2** | `text-[20px]` | 700 | `-0.01em` | Section headings |
| **H3** | `text-[17px]` | 600 | `0` | Card titles |
| **Body** | `text-[14px]` | 400 | `0` | Paragraphs |
| **Small** | `text-[13px]` | 400 | `0` | Secondary text |
| **Caption** | `text-[11px]` | 500 | `0.04em` | Labels, hints |
| **Micro** | `text-[10px]` | 700 | `0.12em` | UPPERCASE labels |
| **Stat value** | `text-[30px]` | 700 | `-0.02em` | StatTile big number |

**Fonts**: Geist Sans (UI), Geist Mono (`.num` for tabular numerals)

---

## 3. Spacing Scale

| Token | Value | Use |
|-------|-------|-----|
| `--space-1` | `4px` | Icon gaps |
| `--space-2` | `8px` | Tight gaps |
| `--space-3` | `12px` | Card inner gaps |
| `--space-4` | `16px` | Card padding (small) |
| `--space-5` | `20px` | Card padding (medium) |
| `--space-6` | `24px` | Card padding (large) |
| `--space-8` | `32px` | Section gaps |
| `--space-12` | `48px` | Screen padding (desktop) |

**Grid gap**: `gap-4` (16px) — consistent across all screens  
**Screen padding**: `px-4 py-5` (mobile), `px-6 py-6` (≥sm)

---

## 4. Radius Scale

| Token | Value | Use |
|-------|-------|-----|
| `--r-card` | `22px` | Cards, sheets |
| `--r-pill` | `999px` | Buttons, badges, pills |
| `--r-lg` | `16px` | Inputs, medium tiles |
| `--r-md` | `12px` | Small tiles, rows |
| `--r-sm` | `8px` | Chips, focus rings |

---

## 5. Shadow Scale

| Token | Value | Use |
|-------|-------|-----|
| `--glass-shadow` | `0 2px 8px rgba(30,41,59,0.06), 0 18px 40px -20px rgba(30,41,59,0.34)` | Glass cards |
| `--ink-shadow` | `0 18px 44px -18px rgba(17,21,27,0.62)` | Charcoal panels |
| `--nav-shadow` | `0 8px 32px -8px rgba(30,41,59,0.28)` | Bottom nav (elevated) |
| `--tile-shadow` | `0 1px 3px rgba(30,41,59,0.08)` | Small tiles, rows |

---

## 6. Component Library

### 6.1 Bottom Navigation (`BottomNav.tsx`)
```tsx
<nav class="fixed bottom-0 inset-x-0 z-50 px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
  <div class="mx-auto max-w-[480px] glass-strong rounded-[var(--r-card)] nav-shadow flex items-center justify-around px-2 py-2">
    {items.map(item => (
      <button class={clsx(
        "flex flex-1 flex-col items-center gap-1 rounded-[var(--r-pill)] py-2 px-1 transition",
        active ? "bg-accent text-ink-panel" : "text-ink-3 hover:text-ink"
      )}>
        <Icon class="h-5 w-5" />
        <span class="text-[10px] font-semibold">{label}</span>
      </button>
    ))}
  </div>
</nav>
```
- **Height**: 56px content + 16px padding = 72px total
- **Safe area**: `env(safe-area-inset-bottom)` for iPhone X+
- **Max width**: 480px centered (tablet/desktop)
- **Badge**: Red dot on Budget tab when `alert_triggered`

### 6.2 Top App Bar (Minimal)
```tsx
<header class="sticky top-0 z-40 px-4 pt-4">
  <div class="mx-auto flex max-w-[1200px] items-center justify-between">
    <LogoMark size={36} />  {/* mark only, no wordmark on mobile */}
    <LiveBadge />  {/* LIVE / OFFLINE pill */}
  </div>
</header>
```
- No nav links — bottom bar handles that
- Live badge polls `/telemetry/is-online` every 5s (from Shell)

### 6.3 Card (`Card.tsx` — unchanged)
Three tones: `glass`, `strong`, `ink`. Used everywhere.

### 6.4 Stat Tile (`StatTile.tsx` — unchanged)
Small KPI with optional navigation arrow. Used in grids.

### 6.5 Threshold Bar (`ThresholdBar.tsx` — unchanged)
Horizontal labelled bar. Used for budget progress, share of plan, tariff brackets.

### 6.6 Section Heading (`SectionHeading.tsx` — unchanged)
Numbered or plain heading with subtitle.

### 6.7 New: Sheet (`Sheet.tsx`)
Bottom sheet for secondary content (tariff table, settings sub-pages).
```tsx
<div class="fixed inset-0 z-[60] flex items-end">
  <div class="absolute inset-0 bg-ink-panel/40 backdrop-blur-sm" onClick={close} />
  <div class="relative w-full glass-strong rounded-t-[var(--r-card)] p-6 slide-up">
    {children}
  </div>
</div>
```

### 6.8 New: Segmented Control (`SegmentedControl.tsx`)
Mode switcher (normal/eco/heavy/away), threshold choices (75/85/90%).
```tsx
<div role="group" class="flex gap-1 rounded-[var(--r-pill)] bg-white/50 p-1.5">
  {options.map(opt => (
    <button class={clsx(
      "flex-1 rounded-[var(--r-pill)] py-2 text-sm font-semibold transition",
      selected ? "bg-ink-panel text-on-dark shadow-sm" : "text-ink-3 hover:text-ink"
    )}>
      {opt.label}
    </button>
  ))}
</div>
```

### 6.9 New: Toast (`Toast.tsx`)
Save confirmation, error messages.
```tsx
<div class="fixed top-4 inset-x-0 z-[70] flex justify-center px-4">
  <div class="glass-strong rounded-[var(--r-pill)] px-4 py-2.5 text-sm font-medium slide-down">
    {message}
  </div>
</div>
```

---

## 7. Chart System

### 7.1 PowerGauge (270° arc) — unchanged
- Full scale = connected load (rounded to 500W)
- Colour bands: `<0.5` accent, `0.5–0.75` amber, `>0.75` warn
- Needle drawn at every value (near-zero legible)

### 7.2 ForecastGauge (180° half-circle) — unchanged
- Full scale = target × 1.4
- Target tick at ~71% of dial
- Delta badge: +% over / −% under

### 7.3 UsageBars (Recharts vertical) — unchanged
- Today = accent bar, others = charcoal gradient
- Dashed allowance rule (red)

### 7.4 PhaseDial (90° compass) — unchanged
- PF = cos(phi), needle at acos(PF)
- 0.72R swept fill in accent

### 7.5 New: WeeklyTrend (Recharts Area, 7d)
```tsx
<AreaChart data={last7Days}>
  <defs>
    <linearGradient id="wt-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#e3ec4a" stopOpacity={0.5} />
      <stop offset="100%" stopColor="#e3ec4a" stopOpacity={0.05} />
    </linearGradient>
  </defs>
  <Area dataKey="kwh" stroke="#e3ec4a" strokeWidth={2} fill="url(#wt-fill)" />
  <XAxis dataKey="label" tickLine={false} axisLine={false} />
  <YAxis hide />
  <Tooltip content={<CustomTooltip />} />
</AreaChart>
```

### 7.6 New: TariffPosition (Recharts stacked bar, 7 brackets)
```tsx
<BarChart data={bracketUsage}>
  <Bar dataKey="used" stackId="a" fill="#2b2f37" radius={[6,6,0,0]} />
  <Bar dataKey="remaining" stackId="a" fill="#ffffff" fillOpacity={0.3} />
  <ReferenceLine y={targetKwh} stroke="#b32a2f" strokeDasharray="5 5" />
</BarChart>
```

### 7.7 New: PeakHeatmap (Custom grid, 30d × 24h)
- 30 columns (days) × 24 rows (hours)
- Cell colour: intensity = avg power in that hour
- Tap cell → tooltip with hour + avg W

---

## 8. Status States

| State | Colour | Icon | Use |
|-------|--------|------|-----|
| **Live** | `--accent` bg, `--ink-panel` text | pulse-dot | Meter reporting <60s |
| **Stale** | `--amber` text | TriangleAlert | Reading 60s–5min old |
| **Offline** | `--warn` bg, white text | XCircle | No reading >5min |
| **Warning** | `--accent-ink` text, `--accent-wash` bg | AlertTriangle | Budget 75–90% |
| **Critical** | `--warn` text, `--warn-wash` bg | OctagonAlert | Budget >90% |
| **Success** | `--ok` text | CheckCircle2 | Saved, under target |
| **Loading** | `--accent` pulse-dot | — | Initial fetch |
| **Error** | `--warn` text, `--warn-wash` bg | XCircle | Fetch failed |

---

## 9. Icon Set (lucide-react)

| Context | Icons |
|---------|-------|
| **Nav** | LayoutGrid (Home), Wallet (Budget), ListChecks (Plan), TrendingUp (Insights), Settings (Settings) |
| **Status** | PulseDot (live), TriangleAlert (stale), XCircle (offline), AlertTriangle (warning), OctagonAlert (critical), CheckCircle2 (success) |
| **Metrics** | Zap (power), Gauge (voltage), Activity (current), Waveform (PF), Flame (energy), Calendar (cycle) |
| **Appliances** | Refrigerator, Lightbulb, AirVent, Flame, WashingMachine, Plug, Tv, Microwave, Fan |
| **Actions** | ArrowUpRight (navigate), ChevronDown (expand), Save, Calculator, Info, Lock, Power, Moon, Ban |
| **Settings** | User, Smartphone, Bell, Palette, Shield, LogOut, Trash2 |

---

## 10. Motion & Animation

| Element | Animation | Duration | Easing |
|---------|-----------|----------|--------|
| Card entrance | `rise` (translateY + fade) | 620ms | cubic-bezier(0.22,1,0.36,1) |
| Gauge needle | `stroke-dashoffset` | 700ms | ease-out |
| Gauge arc | `stroke-dashoffset` | 700ms | ease-out |
| Bar fill | Recharts native | 500ms | ease-out |
| Bottom nav active | bg + scale | 150ms | ease-out |
| Sheet open | `slide-up` (translateY) | 300ms | cubic-bezier(0.22,1,0.36,1) |
| Toast | `slide-down` (translateY + fade) | 250ms | ease-out |
| SceneBackground | `flow`, `spin-disc`, `pulse-dot` | continuous | linear / infinite |
| Page transition | None (SPA) | — | — |

**Reduced motion**: All disabled via existing `@media (prefers-reduced-motion: reduce)`.

---

## 11. Touch & Interaction

| Element | Min Size | Feedback |
|---------|----------|----------|
| Bottom nav item | 56×56px | Scale 1.02 + bg change |
| Button | 44×44px | Opacity 0.9 on press |
| Input | 44px height | Border accent-2 on focus |
| Card | — | Hover lift (desktop only) |
| Icon button | 40×40px | bg-ink-panel on hover |

**Haptics** (progressive enhancement):
```ts
if (navigator.vibrate) navigator.vibrate(10);
```

---

## 12. Safe Areas & Notches

```css
/* Bottom nav */
padding-bottom: max(16px, env(safe-area-inset-bottom));

/* Top app bar */
padding-top: max(16px, env(safe-area-inset-top));

/* Content clearance */
main { padding-bottom: 96px; }  /* bottom nav height + gap */
```

---

## 13. Dark Mode (Future — Tokens Ready)

All tokens defined as CSS variables. Dark variant:
```css
@media (prefers-color-scheme: dark) {
  :root {
    --sky-2: #1a1e24;
    --glass: rgba(43,47,55,0.66);
    --ink: #f1f4f8;
    --ink-2: #c3cbd6;
    --ink-3: #9aa5b4;
  }
}
```
*Not implemented in Phase 4 — tokens prepared only.*

---

## 14. Accessibility (WCAG 2.1 AA)

| Requirement | Implementation |
|-------------|----------------|
| Contrast ≥ 4.5:1 (text) | `--ink` on `--glass` = 12:1 ✓ |
| Contrast ≥ 3:1 (UI) | `--accent` on charcoal = 11:1 ✓ |
| Focus visible | `outline: 2px solid --accent-ink` on all interactive |
| Touch target ≥ 44px | Bottom nav 56px, buttons 44px ✓ |
| Screen reader | Gauges `role="img"` + aria-label, charts `aria-hidden` + table fallback |
| Reduced motion | `@media (prefers-reduced-motion: reduce)` ✓ |
| Live regions | Budget alert `role="alert"`, `aria-live="polite"` |

---

*End of Phase 3. Next: Phase 4 — Implementation (BottomNav, Shell refactor, page redesigns, Insights/Settings, mobile QA).*