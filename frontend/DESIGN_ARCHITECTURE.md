# Wattwise — Design Architecture (Phase 2)

> **Goal**: Define the mobile-first screen hierarchy, navigation, KPI/card/chart taxonomy, and user flows for the redesign. Every decision must preserve existing API contracts, live-data behaviour, PWA installability and the SceneBackground atmosphere.

---

## 1. Navigation — Floating Bottom Bar

| Current | New |
|---------|-----|
| Sticky top glass bar with segmented pills (Overview / Budget / Recommendations) | **Floating bottom bar** (rounded-xl, glass-strong, safe-area inset) |
| Mark + wordmark left, status + account right | **Five destinations** with icons + labels |
| Active = charcoal pill + icon | Active = filled accent background, inactive = glass-soft |

### Bottom Bar Items (left → right)

| Index | Route | Icon | Label | Notes |
|-------|-------|------|-------|-------|
| 0 | `/overview` | LayoutGrid | **Home** | Primary dashboard |
| 1 | `/budget` | Wallet | **Budget** | Target bill planner |
| 2 | `/recommendations` | ListChecks | **Plan** | Today's appliance plan |
| 3 | `/insights` | TrendingUp | **Insights** | New: weekly/monthly trends, tariff position history |
| 4 | `/settings` | Settings | **Settings** | Profile, device, notifications, logout |

- **Active state**: `bg-accent text-ink-panel` with subtle scale (1.02) on press
- **Inactive state**: `glass-soft text-ink-2`
- **Badge support**: Budget tab shows alert badge when `alert_triggered` (red dot)
- **Haptic**: `navigator.vibrate(10)` on tap (progressive enhancement)

---

## 2. Screen Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│  /auth (login/register)          ← No bottom bar           │
│  /onboarding (device pairing)    ← No bottom bar           │
├─────────────────────────────────────────────────────────────┤
│  /overview     ← Home (default)                              │
│  /budget       ← Target bill + tariff inverse                │
│  /recommendations ← Today's plan (mode switcher + allocations)│
│  /insights     ← NEW: trends, tariff history, data quality  │
│  /settings     ← Profile, device, notifications, about      │
└─────────────────────────────────────────────────────────────┘
```

### Auth / Onboarding (No Bottom Bar)
- Full-screen SceneBackground (illustrative, not live)
- Centered glass card with form
- Logo mark + wordmark at top

### Signed-in Screens (All Have Bottom Bar)
- SceneBackground fixed behind everything (live-reactive)
- Content scrolls in `main` with `pb-24` (bottom bar clearance)
- Top app bar: **only** logo mark (left) + live status badge (right) — no navigation

---

## 3. KPI Hierarchy (Per Screen)

### `/overview` — Primary KPI Stack

| Rank | KPI | Component | Size | Position |
|------|-----|-----------|------|----------|
| **1** | **Current Consumption** | PowerGauge (270° arc) | **Large** (hero) | Top-left, spans 2 cols on ≥lg |
| **2** | **Today's kWh** | StatTile (emphasis) | Medium | Top-right |
| **3** | **Predicted Bill** | ForecastGauge (180° half-circle) | Medium | Below gauge, spans 2 cols |
| **4** | **Budget Progress** | ThresholdBar (horizontal) | Medium | Beside forecast |
| **5** | **Energy Usage (14d)** | UsageBars (Recharts) | **Large** | Bottom-left, spans 2 cols |
| **6** | **Appliance Recommendations** | Allocation rows (top 4) | Medium | Bottom-right |
| **7** | **Phase Angle** | PhaseDial | Small | Tucked under as narrow strip |

### `/budget` — Target Bill Planner

| Rank | KPI | Component | Size |
|------|-----|-----------|------|
| **1** | **Allowed kWh** | Big number + unit | **Hero** (56px) |
| **2** | **Daily Average** | MiniStat | Medium |
| **3** | **Bracket Position** | MiniStat | Medium |
| **4** | **Cycle Progress** | ThresholdBar + % | Medium |
| **5** | **Forecast vs Target** | Delta text (over/under) | Medium |
| **6** | **Tariff Table** | Table (7 brackets) | Reference |

### `/recommendations` — Today's Plan

| Rank | KPI | Component | Size |
|------|-----|-----------|------|
| **1** | **Mode Switcher** | Segmented pills (4 modes) | **Hero** (top) |
| **2** | **Budget for Today** | StatTile | Medium |
| **3** | **Essentials Reserved** | StatTile (emphasis) | Medium |
| **4** | **Discretionary Pool** | StatTile | Medium |
| **5** | **Total Planned** | StatTile | Medium |
| **6** | **Share of Plan** | ThresholdBar per appliance | Large |
| **7** | **Essential Appliances** | AllocationRow (locked) | List |
| **8** | **Adjustable Appliances** | AllocationRow (status chips) | List |

### `/insights` (NEW) — Trends & History

| Rank | KPI | Component | Size |
|------|-----|-----------|------|
| **1** | **Weekly Trend** | Area chart (7d) | **Large** |
| **2** | **Monthly Tariff Position** | Stacked bar (brackets) | Large |
| **3** | **Data Quality** | StatTile + badge | Medium |
| **4** | **Forecast Accuracy** | MiniStat (model vs naive) | Medium |
| **5** | **Peak Hours Heatmap** | Calendar heatmap | Medium |

### `/settings`

| Section | Contents |
|---------|----------|
| **Profile** | Email, password, delete account |
| **Device** | Device ID, rename, re-pair, remove |
| **Notifications** | Budget alert toggle, threshold %, push (future) |
| **Display** | Theme (system/light/dark), units, language |
| **About** | Version, licenses, privacy, logout |

---

## 4. Card Hierarchy (Size Taxonomy)

| Size Class | Max Width | Padding | Use Cases |
|------------|-----------|---------|-----------|
| **Hero** | Full bleed (xl: 2-col span) | `p-6` | PowerGauge, UsageBars, Weekly Trend |
| **Large** | xl:col-span-2 / lg:col-span-1 | `p-5` | ForecastGauge, Share of Plan, Tariff Table |
| **Medium** | lg:col-span-1 / sm:col-span-1 | `p-4` | StatTile grid, MiniStat, Budget Progress |
| **Small** | Auto (inline) | `p-3` | AllocationRow, PhaseDial strip |

### Grid System
```css
/* Mobile-first: 1 col → sm: 2 → lg: 3 → xl: 4 → 2xl: 5 */
grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5
gap-4
```

### Card Tones (from existing `Card.tsx`)
- `tone="glass"` — default frosted glass (most cards)
- `tone="strong"` — stronger glass for nav bar, headers
- `tone="ink"` — charcoal anchor (used sparingly: 1 per screen max)

---

## 5. Chart Hierarchy

| Chart | Type | Library | Data Source | Screen |
|-------|------|---------|-------------|--------|
| **PowerGauge** | 270° SVG arc | Custom | `/telemetry/dashboard` live | `/overview` (Hero) |
| **ForecastGauge** | 180° half-circle | Custom | `/predictions` + `/budgets` | `/overview` (Large) |
| **UsageBars** | Vertical bar | Recharts | `/telemetry/daily` (14d) | `/overview` (Hero) |
| **PhaseDial** | 90° compass | Custom | `/telemetry/dashboard` | `/overview` (Small) |
| **Weekly Trend** | Area (7d) | Recharts | `/telemetry/daily` (7d) | `/insights` (Hero) |
| **Tariff Position** | Stacked bar (7 brackets) | Recharts | `/tariff/brackets` + prediction | `/insights` (Large) |
| **Peak Hours Heatmap** | Calendar grid | Custom | `/telemetry/hourly` (30d) | `/insights` (Medium) |

### Chart Design Rules
- **No axis chrome** on mobile — labels inline, tooltips on tap
- **Accent colour** (`#e3ec4a`) for primary series, charcoal for reference
- **Today/Current** always highlighted (accent fill)
- **Allowance/Target** shown as dashed rule (red `#b32a2f`)
- **Stale state**: desaturate to `#8593a5`, show "Last reading Xs ago"

---

## 6. User Flows

### Flow 1: First Launch → Dashboard
```
/auth (register) → /onboarding (pair device) → /overview (auto)
     ↓                    ↓                        ↓
  JWT token          device_id stored        Live data loads
  stored                                           ↓
                                            Bottom bar appears
```

### Flow 2: Daily Check (Primary Use Case)
```
/overview (opens) → PowerGauge animates → ForecastGauge shows predicted bill
     ↓                                                      ↓
  Budget progress bar                                       ↓
     ↓                                                      ↓
  UsageBars (14d) ← swipe → Recommendations (top 4)        ↓
     ↓                                                      ↓
  Tap "Plan" tab → Full recommendations with mode switcher
```

### Flow 3: Budget Adjustment
```
/overview → Budget progress shows 85% → Tap Budget tab
     ↓
  /budget → Edit target → Debounced fetchAllowance → See allowed kWh
     ↓
  Save → Toast confirmation → /overview updates automatically
```

### Flow 4: Mode Change (Eco/Heavy/Away)
```
/recommendations → Tap mode pill → Fetch new allocations
     ↓
  Essential rows stay locked (padlock) → Discretionary rows update
     ↓
  Share-of-plan bars re-render → Total planned kWh updates
```

### Flow 5: Offline / Stale Data
```
Any screen → Meter stops reporting (5s poll fails)
     ↓
  SceneBackground desaturates (saturate-[0.4])
     ↓
  PowerGauge needle grays, "Last reading Xs ago" badge
     ↓
  ForecastGauge shows stale badge, forecast still visible
     ↓
  User sees honest state, no fake loading
```

---

## 7. Responsive Breakpoints

| Breakpoint | Width | Columns | Bottom Bar | Notes |
|------------|-------|---------|------------|-------|
| **Mobile** | 320–374px | 1 | Full width, 5 items | Labels may truncate to icons only at 320px |
| **Mobile** | 375–413px | 1 | Full width, 5 items | Comfortable labels |
| **Mobile** | 414–639px | 1–2 | Full width | sm:grid-cols-2 kicks in |
| **Tablet** | 640–1023px | 2–3 | Centered, max-w-[480px] | Floating pill, not full-width |
| **Desktop** | 1024px+ | 3–4 | Centered, max-w-[480px] | Hover states active |

---

## 8. Animation & Motion

| Element | Animation | Duration | Trigger |
|---------|-----------|----------|---------|
| Card entrance | `rise` (staggered) | 620ms | Mount |
| Gauge needle | `stroke-dashoffset` | 700ms ease-out | Value change |
| Gauge arc fill | `stroke-dashoffset` | 700ms ease-out | Value change |
| Bar chart | Recharts native | 500ms | Mount |
| Bottom bar active | Scale + bg change | 150ms | Tap |
| SceneBackground | `flow`, `spin-disc`, `pulse-dot` | Continuous | `live=true` |
| Page transition | None (SPA) | — | Next.js App Router |

**Reduced motion**: All animations disable via `@media (prefers-reduced-motion: reduce)` — already in globals.css

---

## 9. Accessibility Checklist

- [ ] Bottom bar: `role="navigation"`, `aria-label="Primary"`, each button `aria-current="page"`
- [ ] Gauges: `role="img"`, `aria-label` with value + scale
- [ ] Charts: `aria-hidden` on SVG, data table alternative for screen readers
- [ ] Live regions: `aria-live="polite"` for budget alert banner
- [ ] Focus order: Logo → Bottom bar → Main content → Footer
- [ ] Colour contrast: All text ≥ 4.5:1, accent fills ≥ 3:1 (WCAG 1.4.11)
- [ ] Touch targets: ≥ 44×44px (bottom bar items 56×56px)

---

## 10. API Contract Preservation (Non-Negotiable)

| Existing Endpoint | Used By | Must Not Change |
|-------------------|---------|-----------------|
| `GET /telemetry/dashboard/:deviceId` | Overview, Shell (scene) | ✅ |
| `GET /telemetry/daily/:deviceId` | UsageBars, Insights | ✅ |
| `GET /telemetry/is-online/:deviceId` | Shell (live badge) | ✅ |
| `GET /predictions/:deviceId` | Overview, Budget, Insights | ✅ |
| `GET /budgets/recommendations/:deviceId?mode=` | Overview, Recommendations | ✅ |
| `GET /budgets/active` | Budget, Recommendations | ✅ |
| `POST /budgets` | Budget (save) | ✅ |
| `GET /tariff/allowance?target_bill_egp=` | Budget (inverse) | ✅ |
| `GET /tariff/brackets` | Budget (table), Insights | ✅ |
| `POST /auth/register`, `POST /auth/login` | Auth | ✅ |
| `POST /device/register` | Onboarding | ✅ |

**No new endpoints required for Phase 2–4.** All new UI consumes existing contracts.

---

## 11. Implementation Sequence (Phase 4)

1. **Bottom Navigation** — New `BottomNav.tsx`, update `Shell.tsx`, remove top nav
2. **Overview Redesign** — Reorder cards per KPI hierarchy, hero gauge, 14-day bars
3. **Budget Redesign** — Hero allowed kWh, mini-stats grid, tariff table collapsible
4. **Recommendations Redesign** — Mode switcher hero, stat tiles, share bars, allocation rows
5. **Insights (New)** — Weekly trend, tariff position, data quality, forecast accuracy
6. **Settings** — Profile, device, notifications, display, about
7. **Auth/Onboarding Polish** — Consistent glass cards, SceneBackground illustrative
8. **Mobile QA** — Test at 320, 360, 375, 390, 414, 430px

---

*End of Phase 2. Next: Phase 3 — Design System Specification (tokens, components, charts, status states).*