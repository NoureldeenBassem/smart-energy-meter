# Design brief — Wattwise

Design this from scratch. Ignore anything already in the `design/` folder;
those artboards are a previous direction I am replacing. Delete
`metermind-dashboard.html` — it is left over from an old product name.

## What the product is

Wattwise is a smart energy meter for Egyptian homes. A sensor on the household
electrical panel reports live power draw. The app does three things with it:

1. Shows what the house is drawing right now, and how much energy the current
   billing cycle has used so far.
2. Predicts the month-end bill in Egyptian pounds, using a machine-learning
   model on top of Egypt's seven-bracket progressive tariff. The tariff is
   marginal, so the last kilowatt-hour of the month can cost four times the
   first. That non-linearity is the whole reason the product exists.
3. Turns a budget the user sets ("keep me under 800 EGP") into a daily plan:
   how many hours to run each appliance today. Essential appliances are
   reserved first and are never cut.

Audience: an Egyptian household. Competition judges will see it first.
Tone: calm, precise, trustworthy. It reports money, so it should feel like an
instrument, not a game.

## Screens needed

Three pages, plus a sign-in screen if you want to design one.

- **Overview** — live power, energy this cycle, predicted month-end bill against
  the target, where the household sits in the tariff brackets, daily energy
  history.
- **Budget Planner** — the user sets a target bill in EGP; the app converts it
  to a kilowatt-hour allowance and shows the bracket breakdown.
- **Recommendations** — today's appliance plan, with a household mode switch.

Nav is exactly those three, plus a Live/Offline badge and sign-out.

## Sizes

Both, for all three pages:

- **1440 x 980** desktop
- **390 x 844** mobile — the app installs on phones as a PWA, so this is not
  optional. Show how cards stack, what the nav becomes, and what gets dropped.

## The data you may use

This is the complete list. Every field below is real and fetched from the API.
Please do not invent a metric that is not here — if it is not on this list, the
backend cannot produce it, and the card will have to be deleted during
integration.

**Live reading:** voltage (V), current (A), active power (W), power factor,
energy today (kWh), energy this cycle (kWh), timestamp of last reading.

**Prediction:** predicted kWh for the month, predicted bill (EGP), a low/high
confidence band in both kWh and EGP, a plain-language confidence label, whether
the model or a simple fallback produced it, and if fallback, why. Also: day of
month, days remaining in cycle, cycle length, how many days had readings and how
many are missing.

**Tariff position:** total consumption, total bill so far, which of the seven
brackets is active, the price per kWh at the current bracket, and how many kWh
remain before the next (more expensive) bracket. Also the full bracket table:
seven rows of from-kWh, to-kWh, price per kWh, from 0.68 up to 2.74 EGP/kWh.

**Budget:** target bill in EGP, an alert threshold percentage, percent of budget
used, and whether the alert has fired.

**Today's plan:** the household mode (Normal, Eco, Heavy, Away), total kWh
allowed today, how much of that is reserved for essentials versus discretionary,
whether the plan fits the budget, and a list of appliances. Each appliance has:
name, rated watts, priority, whether it is essential, recommended runtime in
hours, estimated kWh, a status (essential / optimal / constrained / shed / away)
and a short note explaining the recommendation.

**History:** one row per day — the date, total kWh that day, and peak watts.

## States that must be designed

These are not edge cases; they are the moments the product matters.

- **Offline.** The meter stops reporting. The app deliberately refuses to show
  a number it cannot stand behind, so this state must look clearly degraded —
  desaturated, still, honest. Never a stale number presented as live.
- **Over budget.** Predicted bill above the target. This is the alarm state and
  should be the most visually decisive screen in the set.
- **Low confidence.** Early in the month, or with missing days, the prediction
  falls back to a simple average and says so. Design how that admission looks —
  it should read as careful, not broken.

## Visual direction

Yours. I am not attached to the previous palette. Two constraints only:

1. **Contrast must pass WCAG AA.** The last direction used a yellow-green
   (#e3ec4a) that measures 1.31:1 on white — it worked as a fill and was
   invisible as text. Whatever you pick, check it as text before you use it as
   text.
2. **Numbers need a tabular figure font.** Readings update live, and
   proportional digits make them jitter.

Things worth leaning into if they suit your direction: the tariff is a staircase,
and the household's position on that staircase is genuinely the most interesting
data in the product. A bill prediction has a range, not a point. And the
distinction between "essential" and "discretionary" energy is a real hierarchy
the layout could express.

## Deliverable

Plain HTML artboards with inline styles, plus a canvas file laying them out.
No React, no framework code, no data fetching — I handle the integration into
the live Next.js app myself. Design fidelity is what I need from you.
