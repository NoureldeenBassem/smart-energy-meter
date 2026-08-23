# Submission Status — Smart Energy Meter (IoT + AI)

**Last updated:** 2026-08-23

This document states honestly what works, what is partially built, and what is not
built at all. It exists so that nothing in the demo or the report overstates what
was actually achieved. Where a number appears, it is a measured number and the
measurement method is given.

---

## 1. Bill prediction (the core AI claim)

### What is claimed

A LightGBM model predicts the household's total kWh at the end of the billing
cycle, and it beats a naive baseline on average across cycles.

### The baseline it is measured against

`naive = kwh_so_far + (7-day rolling average daily kWh × days remaining)`

This is a genuinely strong baseline, not a strawman. It is exact at the end of a
cycle (zero days remaining ⇒ zero error) and already achieves ~3.7% MAPE in the
second half of a cycle. The model has to beat that.

### Measured results

Validation method: **purged walk-forward, chronological, never randomly shuffled.**
A fold may train only on cycles whose `cycle_end_date` precedes the test cycle's
`cycle_start_date`. Alpha (the correction scaling factor) is selected only from
folds ending before the test cycle starts, so no test-set information reaches
model selection.

Dataset: UCI Household Power Consumption (public), aggregated to daily kWh.

| Dataset / range | Naive MAE | Model MAE | Naive MAPE | Model MAPE | Improvement | Cycles beaten |
|---|---|---|---|---|---|---|
| Sliding, day 3–30 (5880 preds / 210 folds) | 50.52 | 41.88 | 7.26% | 6.27% | **+17.10%** | 161/210 (77%) |
| **Sliding, day 15–30 (the judged gate)** | **26.30** | **23.47** | **3.69%** | **3.42%** | **+10.75%** | **146/210 (70%)** |
| Sliding, day 3–14 | 82.81 | 66.42 | 12.02% | 10.07% | +19.79% | 161/210 (77%) |
| Disjoint, day 3–30 (952 preds / 34 folds) | 48.57 | 40.09 | 6.92% | 5.38% | +17.47% | 25/34 (74%) |
| Disjoint, day 15–30 | 26.97 | 23.96 | 4.00% | 3.44% | +11.15% | 20/34 (59%) |
| Disjoint, day 3–14 | 77.38 | 61.59 | 10.81% | 7.96% | +20.41% | 24/34 (71%) |

The acceptance gate is judged on the **harder day 15–30 subset**, not the more
flattering full-range figure, because that is where the baseline is already
strong and where beating it actually means something.

### Honest caveats — read these before quoting the numbers above

**The margin is real but thin.** The gate passes at **+10.75%** against a
**10.0%** minimum. On the disjoint set at the judged range it beats the baseline
on only **59% of individual cycles (20/34)**, meaning it wins by larger margins on
the cycles it wins rather than winning consistently.

> **Q&A framing:** *"It beats the baseline on average across cycles; it is not
> guaranteed to beat it on any single cycle."*

**There is selection pressure in that number.** Feature choices and the forecast
horizon were decided with pooled test metrics visible. The disjoint cross-check
(+11.15% vs +10.75%) limits this but does not eliminate it, because it draws on
the same underlying household history. The honest reading is that +10.75% is the
optimistic end of the plausible range, not a guaranteed out-of-sample figure.

**The demo screen is not the accuracy evidence.** On the seeded synthetic backfill
used to make the dashboard demonstrable, the model's correction is only
**+2.95 kWh (0.55%)** over the naive baseline. That is *not* a weak result being
hidden — it is the expected outcome, because the synthetic series is near-
stationary and a 7-day rolling average is already close to optimal on data with
no real behavioural variation. There is nothing there for the model to correct.

> **The accuracy claim rests on the +10.75% pooled walk-forward result on real UCI
> household variation — not on any number visible on the demo dashboard.**
> If a judge points at the dashboard and asks "so the model only helps by 0.5%?",
> the answer is that the dashboard is running on synthetic data by necessity and
> the measured improvement comes from real households.

**The training data is a European proxy, not Egyptian.** UCI is a French
household. No public Egyptian per-household consumption dataset of comparable
granularity was available. Consumption *shape* transfers reasonably (base load
plus temperature-driven cooling load), but this is a proxy and is stated as one.

**The model is refused outside its validated domain.** It predicts an *absolute*
per-day kWh correction and a gradient-boosted tree cannot extrapolate. The API
therefore serves the naive baseline instead, with the reason returned in the
response, when:

- fewer than 3 days have elapsed, or fewer than 3 days carry telemetry;
- under 80% of elapsed days carry telemetry (every training cycle had complete
  daily coverage);
- the household's average daily consumption falls outside the
  **4.24–54.47 kWh/day** range recorded in the model artifact.

Both guards hold for 100% of validation rows by construction, so enforcing them
cannot and does not change any reported accuracy figure. This was found by a real
failure: on a device averaging 0.78 kWh/day the model returned a **+264%**
correction — a leaf value calibrated for a 25 kWh/day home, confident-looking and
evidence-free.

A correction-magnitude cap was **considered and rejected**: on in-distribution
rows the correction legitimately reaches 2.53× naive (p99.9 = 1.97), so capping
would fire on real rows and distort the measured MAE.

### Confidence range

The displayed range is the **empirical p80 of held-out absolute error**, not an
assumed normal distribution. So "80% of held-out validation forecasts fell within
this range" is a directly checkable claim.

Held-out |error| quantiles (kWh):

| Range | Model p50 | Model p80 | Model p90 | Naive p50 | Naive p80 | Naive p90 |
|---|---|---|---|---|---|---|
| day 3–14 | 44.8 | 99.2 | 145.4 | 61.4 | 125.3 | 174.1 |
| day 15–30 | 13.2 | 37.2 | 54.2 | 14.7 | 42.6 | 64.3 |
| full range | 23.7 | 62.9 | 100.9 | 28.0 | 81.0 | 124.9 |

The model's band is tighter than the baseline's at every quantile. The band is
much wider early in a cycle and the API reports that honestly rather than
flattening it to one comfortable number.

### Reproducing these numbers

```bash
cd backend
python -m ml.training.prepare_public_dataset          # sliding, stride 5
python -m ml.training.train_model                     # prints the full table + gate
python -m ml.training.verify_artifact                 # replays real days through the API's own feature builder
```

The acceptance gate (`MIN_MAE_IMPROVEMENT_PCT = 10.0` in `ml/training/train_model.py`)
was **not** lowered to force a pass. If the model fails it, no artifact is saved
and the naive baseline remains the served prediction.

---

## 2. Aggregation pipeline

### What is claimed

`telemetry_raw` is rolled up into hourly and daily aggregates by
`app/workers/aggregation_worker.py`, idempotently, on **Africa/Cairo local day
boundaries**.

### Status: working and verified

`GET /telemetry/daily/{device_id}?days=30` returned **2 rows** before this work and
returns **22 real days summing 387.7243 kWh** after it.

### A real bug this uncovered: the daily rollup was bucketing by UTC day

> This is one of **four** code paths that made the same mistake. §7 collects them
> and treats it as a single systemic root cause rather than four separate bugs.

Cairo is UTC+3 in August, so the first three hours of every local day were being
credited to the previous day. Measured across the live dataset:

| Local day | kWh under Africa/Cairo | kWh under UTC |
|---|---|---|
| 2026-08-21 | 22.6676 | 21.9910 |
| **2026-08-22 (today)** | **1.5929** | **0.0673** |

The dashboard's "today's usage" figure — the first number a judge sees, and the
hook of the whole demo narrative — would have read essentially zero for the first
three hours of every day.

Two further defects were fixed in the same worker: the daily grain was computed
from the hourly table (an unweighted average of averages) rather than from raw, and
there was no lookback window at all, so every pass rescanned the entire table.

The fix uses the **named IANA zone `Africa/Cairo`**, not a hardcoded `+02:00` or
`+03:00`. Egypt has changed its DST rules more than once in recent years; a
hardcoded offset would be wrong for part of any year in which the rules move
again. The same `app/core/billing_time.py` helpers now back the rollups, the bill
forecast, and the recommendation budget, so all three agree on which day it is.

### Correctness evidence

**Per-bucket reconciliation against raw** — all 508 hourly buckets:

```
missing_buckets | mismatched_buckets
----------------+--------------------
              0 |                  0
```

**Cross-grain totals agree** to the limit of per-bucket 4-decimal rounding:

```
daily total                  387.7243 kWh
hourly total                 387.7250 kWh
raw total                    387.7244 kWh
forecaster's kwh_so_far      387.7244 kWh
```

**Idempotency** — md5 over every rollup row, after four different invocations:

```sql
SELECT md5(string_agg(row_text, '|' ORDER BY row_text)) FROM (
  SELECT 'H:'||device_id||':'||bucket_start||':'||total_energy_kwh||':'
             ||avg_power_w||':'||peak_power_w AS row_text FROM telemetry_hourly
  UNION ALL
  SELECT 'D:'||device_id||':'||bucket_start||':'||total_energy_kwh||':'
             ||avg_power_w||':'||peak_power_w              FROM telemetry_daily
) s;
```

| Invocation | Buckets touched | Checksum |
|---|---|---|
| baseline (no run) | — | `d3835c26174ec01ab20465126c5a4d35` |
| `--once --all` | 508 hourly / 22 daily | `d3835c26174ec01ab20465126c5a4d35` |
| `--once` (3-day window) | 76 hourly / 4 daily | `d3835c26174ec01ab20465126c5a4d35` |
| `--once --days 7` | 172 hourly / 8 daily | `d3835c26174ec01ab20465126c5a4d35` |

Row counts unchanged throughout: 508 hourly, 22 daily.

The two windowed runs are the load-bearing ones. They prove the lookback cutoff is
snapped to whole **local** days, so a partial window never recomputes a bucket from
a subset of its rows. A bare timestamp cutoff would have silently halved the
boundary bucket, and the full-rebuild run alone would not have caught it.

The checksum value is specific to the query above — any change to the column list
or the separators produces a different hash. It is quoted with the query so it can
be regenerated rather than taken on trust.

It is also specific to **this dataset snapshot**, taken before any live telemetry
was added. Writing new readings changes it, by design — that sensitivity is what
makes it a usable idempotence probe in the first place. The claim being made here
is "re-running the worker over fixed input changes nothing", not "this hash
describes the database forever". See §11.

### Known limitation: `avg_power_w` is sampling-weighted

On days that mix live 5-second samples with hourly backfilled readings, the daily
`avg_power_w` is visibly inconsistent with the day's energy. 2026-08-19 reports
**1296.23 W**, while 16.6407 kWh over 24 h implies **~693 W**. The cause is that
`AVG(power_w)` weights every stored row equally and the live samples outnumber the
backfilled ones by roughly 720:1.

This is left as-is deliberately. The alternative — deriving the mean from energy
over elapsed time — would treat "appliance switched off" and "meter not observing"
as the same thing, and would introduce a second definition of average power
alongside the one `/telemetry/hourly` already serves. One consistent definition
that is documented beats two that disagree.

**`total_energy_kwh` is the authoritative energy figure**, it is exact, and it is
what every downstream consumer (forecast, tariff, recommendations) actually reads.
No frontend component reads `avg_power_w`.

---

## 3. Telemetry timestamps

Readings carry the **device's own measurement timestamp**, not their arrival time.
`scripts/mock_esp32.py` previously sent no `timestamp` field at all, so every
reading silently fell back to arrival time and any replayed history collapsed into
the instant it was published.

Verified by publishing five minutes of buffered history in one burst:

```
rows | total_kwh | ts_span             | ts_spacing | arrival_span
-----+-----------+---------------------+------------+-------------
  60 |    0.1117 | 01:18:26 -> 01:23:21|    5.00 s  |    0.617 s
```

Five minutes of history delivered in 0.6 s with original spacing and the energy
total intact. Under the previous behaviour all 60 rows would have carried
timestamps inside that 0.617-second window. This is what makes the ESP32's offline
buffer worth having: `energy_wh_delta` is a per-reading delta rather than a
cumulative counter, so a gap can be backfilled later without double-counting and
without a counter reset corrupting the total.

All 61 test rows were removed afterwards, and the rollup was rebuilt and confirmed
to match its pre-test state (10026 raw rows, 508 hourly, 22 daily buckets), so the
demo dataset remains reproducible from
`tools/backfill_demo_cycle.py --seed 20260822`.

**Limitation:** the simulator draws voltage, current and power factor
independently at each tick, which is not physically realistic and inflates
`peak_power_w` relative to the mean. It is a contract exerciser, not a load model.
The realistic profile used for the demo dataset comes from
`tools/backfill_demo_cycle.py`.

---

## 4. Recommendation engine

### What is claimed

A greedy allocator keeps the household inside a daily kWh budget while **never
restricting an appliance marked essential**.

### Status: working and verified

151 tests pass, of which 77 cover this engine
(`backend/tests/test_recommendation_engine.py`).

### A real bug this uncovered: essentials were not protected at all

The engine had no concept of an essential appliance. It read `priority == "High"`
as if it meant essential, but that only reordered the greedy loop — it reserved
nothing. Measured on a 150 W refrigerator wanting 24 h/day:

| Scenario | Runtime granted | Status returned |
|---|---|---|
| Away mode | **0.0 h** | `shed` — *"Avoid running today if possible"* |
| 10 EGP/month budget | **9.8 h** | `constrained` |
| 0 EGP budget | **0.0 h** | `shed` |

Away mode was the worst case: its multiplier is `0.0`, so the allowance was zero
and the appliance that most needs to keep running while the house is empty was
told to switch off.

Two existing tests passed against this behaviour and gave false confidence. One
asserted only `status != "away"` — and the status was `shed`, not `away`. The other
asserted the fridge kept 24 h under a tight budget, which held only because at
that particular budget it happened to fit.

### The fix

`appliances.is_essential BOOLEAN NOT NULL DEFAULT FALSE` is now a real column, and
the allocator runs in two stages: essentials are granted their full runtime and
their cost subtracted **before** the greedy loop starts, so no budget arithmetic
can reach them. Essentials never enter the loop in any mode.

`is_essential` and `priority` are now genuinely separate. `priority` is a soft
ordering among non-essentials only — a High-priority non-essential still gets
trimmed. Both directions are tested with fixtures that deliberately disagree: an
essential Low-priority water pump (protected) and a non-essential High-priority AC
(trimmed).

Live output, same device, all four modes, 800 EGP target:

```
mode=normal  budget_share=12.076  essentials=3.6  discretionary=8.476  allocated=11.10  within_budget=True
       LOCKED Refrigerator     24.0 h   3.60 kWh  essential
              Air Conditioner   5.0 h   7.50 kWh  optimal
mode=eco     budget_share=12.076  essentials=3.6  discretionary=6.781  allocated=10.35  within_budget=True
       LOCKED Refrigerator     24.0 h   3.60 kWh  essential
              Air Conditioner   4.5 h   6.75 kWh  constrained
mode=away    budget_share=12.076  essentials=3.6  discretionary=0.000  allocated= 3.60  within_budget=True
       LOCKED Refrigerator     24.0 h   3.60 kWh  essential      <-- keeps running
              Air Conditioner   0.0 h   0.00 kWh  away
```

### Where the two requirements genuinely conflict

"Never restrict essentials" and "never exceed budget" are **not always
simultaneously satisfiable**. If the essential load alone costs more than the
budget allows, one of them must break.

This engine always keeps the essentials whole and reports the overrun rather than
hiding it — `within_budget` goes `False` and `budget_note` explains why:

> Essential appliances alone need 4.0 kWh/day, but the budget allows 1.47 kWh/day.
> Essentials are never restricted, so this target bill is not achievable without
> removing an appliance from the essential list or raising the target.

Silently trimming the fridge to make a budget look achievable, or reporting
"within budget" while overspending, would both have been dishonest resolutions. An
unreachable budget is a fact about the budget.

### Smaller correctness fix

Constrained runtimes are now **floored** to 0.1 h rather than rounded to nearest.
Rounding up breached the allowance the appliance had just been clamped to: a 150 W
load given 1.0 kWh wants 6.667 h, which rounds to 6.7 h and costs 1.005 kWh. Small,
but it made the "never exceeds budget" guarantee untestable. There is a dedicated
regression test.

---

## 5. Schema and data integrity

### A real defect found: the live database was missing three declared tables

`db/schema.sql` declares 10 tables. The running database had 7. `tariff_brackets`,
`bills_predicted` and `recommendations` had never been created, because the
database had been built with `create_tables.py` (SQLAlchemy `create_all()`), which
can only create tables that have an ORM model — and those three had none.

The ORM-created tables also lack the database-level defaults that `schema.sql`
specifies. SQLAlchemy applies `default=uuid.uuid4` in Python, so an
`INSERT … RETURNING` issued outside the ORM fails with a not-null violation on
`device_id`. That is how the divergence was first noticed.

Resolved by applying `schema.sql` as the authoritative DDL. Before doing so the
file was scanned for destructive statements (there are none — only `ON DELETE
CASCADE` constraint clauses and one `ON CONFLICT DO NOTHING` seed) and every table
count was recorded. Afterwards: the 7 pre-existing tables unchanged (4 users /
1 device / 6 appliances / 1 budget / 10026 telemetry_raw / 508 hourly / 22 daily),
3 tables added, 7 tariff brackets seeded.

`README.md` now documents `schema.sql` as authoritative and states why
`create_tables.py` should not be used to build the database.

**Resolved since:** `tariff_brackets` and `recommendations` now have ORM models
(`TariffBracketRow` and `Recommendation` in `app/models/models.py`), so the ORM's
view of the schema and `schema.sql` finally declare the same ten tables.

The ORM class is named `TariffBracketRow`, not `TariffBracket`, because the tariff
calculator already exports a frozen dataclass by that name. Two types describing
the same concept under one name in one codebase is how the two quietly get swapped
at a call site. The calculator's `EGYPT_TARIFF_BRACKETS` constant remains the
authority for every bill computed; the table stays a dated audit record.

**The underlying trap is now closed at the source.** Adding the models would have
made `create_all()` produce all ten tables — but still without the DB-level
`DEFAULT gen_random_uuid()` and CHECK constraints, so a database built that way
would still have been subtly wrong, and `CREATE TABLE IF NOT EXISTS` would still
have made it permanent. So both callers were changed rather than just the models:

- `app/main.py` no longer calls `create_all()` on startup. It verifies the schema
  and logs exactly which tables are missing, naming the command that fixes it.
- `create_tables.py` no longer builds from `models.py`. It applies `db/schema.sql`
  and then verifies all ten tables exist.

There is now one authoritative DDL and no code path that can quietly produce a
different one.

### The `is_essential` migration

`schema.sql:198` already declared the column, but `CREATE TABLE IF NOT EXISTS`
skips an existing table, so the live `appliances` table never received it. Applied
as an explicit additive migration inside a transaction:

```sql
ALTER TABLE appliances ADD COLUMN IF NOT EXISTS is_essential BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE appliances SET is_essential = TRUE WHERE priority = 'High';   -- UPDATE 4
```

`NOT NULL` is safe here because `DEFAULT FALSE` fills existing rows. The
`priority = 'High'` backfill was the only signal available, since the old schema
had no way to record essentiality; all four High-priority rows are refrigerators,
which is the intended meaning. Result: 6 appliances preserved, 4 essential, 2 not.
The live column definition now matches `schema.sql:198` exactly
(`boolean NOT NULL DEFAULT false`), and all other tables were verified unchanged.

---

## 6. Tariff engine

### What is claimed

Egyptian residential electricity is billed on a **progressive marginal** schedule:
each bracket's rate applies only to the slice of consumption that falls inside it.
The engine implements that forward (kWh → EGP) and, less obviously, backward
(a target bill → the kWh that produces it).

### Status: working and verified

Seven brackets, in `backend/app/services/tariff_engine/calculator.py`:

| Bracket | kWh range | EGP/kWh |
|---|---|---|
| 1 | 0–50 | 0.68 |
| 2 | 50–100 | 0.95 |
| 3 | 100–200 | 1.15 |
| 4 | 200–350 | 1.72 |
| 5 | 350–650 | 2.18 |
| 6 | 650–1000 | 2.40 |
| 7 | 1000+ | 2.74 |

**Marginal, not flat-per-tier.** This is the property most implementations get
wrong: at 400 kWh the bill is *not* 400 × 2.18. It is 50×0.68 + 50×0.95 +
100×1.15 + 150×1.72 + 50×2.18, and the difference is large enough to make every
downstream number wrong if it is missed. The pytest suite pins each bracket
boundary individually.

**The inverse is exercised, not asserted.** `bill_to_kwh` is verified by
round-tripping its output back through `calculate_bill`:

| Target bill | `bill_to_kwh` | back through `calculate_bill` |
|---|---|---|
| 200 EGP | 202.035 kWh | 200.00 EGP |
| 500 EGP | 370.872 kWh | 500.00 EGP |
| 800 EGP | 508.486 kWh | 800.00 EGP |
| 1000 EGP | 600.229 kWh | 1000.00 EGP |
| 2000 EGP | 1018.796 kWh | 2000.00 EGP |

The progressive effect is visible in that table: **10× the bill buys only ~5× the
kWh.** The Budget Planner screen prints `bill_at_allowance` from this same round
trip, so the inverse is demonstrated on screen rather than claimed.

### Two endpoints added for the Budget Planner

`GET /tariff/brackets` and `GET /tariff/allowance?target_bill_egp=…`. Neither
requires authentication — they expose no user data, only the published tariff and
a pure function of it.

`/tariff/brackets` is served from the `EGYPT_TARIFF_BRACKETS` constant, **not**
from the `tariff_brackets` table. The constant is the definition the bill is
actually computed from; shipping the database copy to the UI would let the screen
and the arithmetic drift apart silently.

### Honest limitations

- **The rates are hardcoded constants, not fetched.** They are the published
  residential schedule used as this project's reference; there is no mechanism to
  update them, and no effective-date versioning. A real tariff change would
  require a code change and would silently reprice historical bills.
- **`tariff_brackets` exists in the database and is seeded, but nothing reads
  it.** Two representations of the same table now exist. The calculator's
  constant is authoritative and the DB copy is currently decorative — a real
  divergence risk, recorded rather than papered over.

---

## 7. One root cause, four code paths: "today" computed without a timezone

This is the single most instructive defect in the project, and it is worth reading
as **one systemic root cause rather than four unrelated bugs.**

**The root cause:** four independent places in the codebase each needed to answer
"which day is it, and when did this billing cycle start?" — and each answered it
by constructing a UTC date from `datetime.now()`. Cairo is UTC+3 in August, so
every one of them silently attributed the first three hours of each local day to
the wrong day. The same wrong assumption, arrived at four times, because the
question had been re-implemented four times instead of answered once.

| Site | What it answered for itself | Measured before/after | Written up in |
|---|---|---|---|
| `aggregation_worker.py` | Daily rollup bucket boundaries | today **0.0673 → 1.5929** kWh | §2 |
| `routes/telemetry.py` | `today_energy_kwh`, `month_energy_kwh` | today **0.0673 → 1.5929**; month **386.5033 → 387.7244** | below |
| `bill_forecast.py` | Cycle start, days elapsed/remaining | Not separately measured — converged onto the shared helper | §2 |
| `recommendation/engine.py` | Today, cycle length, daily allowance | Not separately measured — converged onto the shared helper | §2 |

The first two rows are measured, with the wrong number and the right one both
recorded. The last two are reported as what they are: the same duplicated date
arithmetic, replaced by the shared helper so they cannot drift from the other two.
No before/after figure is claimed for them, because none was captured — the fix
there was consolidation, and inventing a delta to make the table symmetrical would
be exactly the kind of number this document exists to avoid.

### The fourth site, found while building the frontend

The dashboard route was the last one found, and the worst placed: it sits directly
under the Overview page's headline number. Before building the page on
`/telemetry/dashboard`, its live payload was fetched and checked against the
forecaster's own figures. They disagreed:

| Field | Was (UTC buckets) | Correct (Africa/Cairo) |
|---|---|---|
| `today_energy_kwh` | 0.0673 | **1.5929** |
| `month_energy_kwh` | 386.5033 | **387.7244** |

`today_energy_kwh` was the worse of the two. Between local midnight and 03:00 the
UTC "today" had not started yet, so the figure read essentially zero — the bug was
**worst exactly when someone glanced at the dashboard early in the morning**, which
is the failure mode most likely to be seen and least likely to be reproduced on
demand. `month_energy_kwh` was wrong in the same direction and disagreed with the
`kwh_so_far` printed beside it by the predicted bill.

Fixed by deleting both raw SQL sums and delegating to the same helpers the other
three sites now use — `cycle_start(today_local())` and `daily_kwh_this_cycle()`.
The two figures are now identical (both 387.7244) because they are the same call.
Verified live after restart.

### The structural fix, not just the four patches

All four sites now go through `app/core/billing_time.py`, which is the only module
permitted to decide what "today" means. Seven modules import it; the duplicated
date arithmetic is gone. Two properties of that module matter:

- **It uses the named IANA zone `Africa/Cairo`, never a hardcoded `+02:00` or
  `+03:00`.** Egypt has changed its DST rules more than once in recent years, and
  a hardcoded offset would be wrong for part of any year in which they move again.
  A fixed offset would have looked like a fix and reintroduced the bug later.
- **Agreement is now structural rather than coincidental.** The rollups, the
  forecast, the recommendation budget and the dashboard cannot disagree about which
  day it is, because there is one implementation. That is why
  `month_energy_kwh == kwh_so_far` exactly, and it is checked in §2's cross-grain
  reconciliation.

**How it was found is the transferable part:** not by reading the code. By fetching
the real response and reconciling it against another endpoint's number before
building anything on top of it. Three of the four sites individually looked
reasonable in isolation; what exposed them was two components that should have
agreed, not agreeing.

---

## 8. Authentication and authorisation

### Status: working

Registration and login issue a JWT (`python-jose`, HS256); passwords are hashed
with bcrypt and never stored or logged in plaintext. The frontend attaches the
token through a single axios request interceptor.

**Authorisation is enforced at the query, not in the UI.** Every device,
appliance, budget, telemetry and prediction route filters on
`user_id == <token subject>` in the SQL itself, and an unowned `device_id` returns
**404, not 403** — a 403 would confirm the row exists. `telemetry.py` routes go
through one shared `_verify_device_ownership` helper rather than repeating the
filter. This was checked route by route rather than assumed.

### Known limitations, stated not hidden

- **`POST /telemetry` takes no credentials.** A device is not a user, so a user
  JWT is the wrong instrument, and per-device tokens are not implemented. This
  matches the MQTT posture (the broker allows anonymous publish), so it adds no
  attack surface beyond what MQTT already has — but on an untrusted network
  either path would let an attacker inject readings for a registered
  `device_id`. Only a registered `external_id` is accepted, which limits
  injection to devices that already exist. **Device credentials are required
  before any real deployment. They are not built.**
- **`POST /devices` re-homes an already-registered device to the caller**
  (`devices.py:34-50`). Any authenticated user who knows an `external_id` takes
  ownership of that device. This is deliberate for a single-device demo re-paired
  across test accounts, and it is commented as such in the code — but it is a
  real multi-tenant hijack and it is **not fixed**. See §10.

---

## 9. Frontend

### Status: working, rendering live API data

Next.js 16 App Router, React 19, Tailwind 4. Three screens behind an auth guard
(`components/Shell.tsx`: no token → `/auth`, token but no device → `/onboarding`).
All three were verified by screenshot against the live API with **zero console
errors**.

**`/overview`** is ordered as an argument, and the sections are numbered on screen
so the order reads as deliberate:

1. **Right now** — live power gauge, today's kWh, instantaneous V/A/PF.
2. **Where the month is heading** — the predicted bill with its confidence range,
   plus a *Method* card naming LightGBM vs naive, the size of the model's
   correction, the model version, and the day-coverage of the data behind it.
3. **What to do about it** — budget status and the top of today's plan.

**`/budget`** takes a target bill and shows the kWh it allows, the bracket it
lands in, and the full bracket table explaining why it is not a flat rate.

**`/recommendations`** shows today's per-appliance plan with essentials in their
own padlocked group above the adjustable ones.

### Three deliberate design decisions

**No backend number is recomputed in the browser.** The tariff inverse, the budget
split and the confidence band are all fetched. Re-implementing a seven-bracket
progressive inverse in TypeScript would give the screen its own opinion about what
800 EGP buys, and the first time the brackets changed the two would disagree
silently. Every keystroke in the planner costs one debounced request instead. The
only browser-side arithmetic is presentational (a marker's left offset, a
percentage bar) and each site is commented as such.

**The gauge's scale is fixed, labelled, and derived from the household** — the sum
of registered appliance ratings, rounded up, with both endpoints printed. Two
alternatives were rejected: a generic 3000 W dial (on a 1650 W household the top
half is decoration) and auto-scaling to the current reading — that one is the
dishonest option, because the needle would sit in the same place at 67 W as at
1600 W and the dial would stop carrying information.

**The padlock is a picture of the backend, not a UI convention.** `is_essential`
is a hard constraint: the allocator reserves an essential appliance's full runtime
before any budget arithmetic runs, in every mode including *away*. There is no
request that screen could send that would reduce that number. `priority` is
deliberately **not** drawn as protection — a High-priority non-essential appliance
gets trimmed like any other, and showing the two the same way is the exact
conflation that made the guarantee fake in the first place (§4).

### Known frontend limitations

- **`src/lib/device.ts` hardcodes `DEFAULT_EXTERNAL_ID = "esp32_meter_01"`.** The
  onboarding flow therefore always claims the one demo device. This is the
  client-side half of the re-homing issue in §8 and is not fixed.
- **A stale reading is labelled, not hidden.** When the meter has stopped
  reporting the gauge greys out and says *"Last stored reading — the meter is not
  reporting right now"*, and the header badge reads **Offline**. Both are visible
  in the current screenshots, because the demo dataset ends at 03:00 Cairo and no
  simulator was running. That is the honest rendering of the actual state, and it
  is what a judge will see unless `scripts/mock_esp32.py` and the MQTT worker are
  started first.
- **`/dashboard` is a redirect to `/overview`.** The old combined screen was
  split; the route is kept so a stale bookmark does not 404 mid-demo.

---

## 10. Designed but not built

These are scoped out honestly. Each is a decision, not an oversight, and none of
them is described anywhere in the submission as working.

**Device claiming / pairing, and the re-homing hijack fix (§8).** The fix needs a
claim token issued at manufacture or first boot, a pairing window, and a
migration for the existing row — plus a decision about what happens to telemetry
already attributed to the previous owner. Rushing an auth-boundary change the day
before submission is how you ship a worse bug than the one you started with, so
the current behaviour stays, commented, and is reported here as a known hijack.

**Wi-Fi captive portal firmware.** The ESP32 provisioning flow (SoftAP →
credential capture → reconnect) is designed but not implemented. Demos use a
hardcoded SSID or the Python simulator.

**Offline gap handling with interpolated-vs-real flagging.** `is_backfilled`
exists in the data contract and in the schema, and the seeded demo dataset sets
it, but there is no firmware-side buffer-and-replay for a meter that loses
connectivity, and no UI that distinguishes an interpolated day from a measured
one. Until that exists, a gap is simply a gap — which is why the *Method* card on
`/overview` prints day-coverage (`22/22 elapsed days carry telemetry`) rather than
letting the forecast imply completeness it cannot verify.

**Firmware for the ESP32 meter.** The hardware has not arrived; there is no
firmware in the repository at all. The data contract it will publish against is
built and exercised. See §12, which states the full scope of what is and is not
proven without a physical device.

---

## 11. Running the demo

```powershell
# 1. Infrastructure
cd backend; docker compose up -d          # postgres :15432, mosquitto :1883

# 2. API
.\venv\Scripts\python.exe -m uvicorn app.main:app --port 8000

# 3. Frontend
cd ..\frontend; npm run dev               # :3000

# 4. Live telemetry — the live-demo moment; read the note below first
cd ..\backend
.\venv\Scripts\python.exe -m app.workers.telemetry_worker
.\venv\Scripts\python.exe scripts\mock_esp32.py
```

**Note on step 4 and the §2 checksum — read this before quoting the hash.**
Running the simulator is the *intended* live-demo moment, not a compromise. It is
expected to write new rows into `telemetry_raw`, and once it does, the rollup
checksum in §2 will no longer be `d3835c26174ec01ab20465126c5a4d35`. **That is
correct behaviour, not a regression.** Being precise about what each claim covers:

- **What §2's checksum proves** is that the aggregation worker is *idempotent* —
  re-running it over a fixed input produces byte-identical rollups regardless of
  window. That is a property of the code, and fresh telemetry does not touch it.
- **The literal hash value** is a fingerprint of one specific snapshot: the 22-day
  seeded backfill, before any live rows were added. It is a point-in-time
  measurement, **not a standing guarantee about whatever the database currently
  holds.** New data changing it is exactly what a fingerprint is supposed to do.
- **`--seed 20260822` reproducibility** means the seeded dataset can be
  regenerated from the seed on a clean database. It does not mean the live
  database stays equal to it forever.

So: run the simulator for the demo. The one thing that would be false is quoting
`d3835c26174ec01ab20465126c5a4d35` as the *current* database fingerprint after
live rows have landed. If the checksum needs to be re-demonstrated after a live
demo, re-run the §2 query to get the new baseline and show idempotence against
*that* — the property holds on any snapshot; only the number moves.

Leaving the simulator off is also a legitimate thing to show: the dashboard's
**Offline** state is correct behaviour being rendered honestly, not a missing
feature.

---

## 12. Hardware status — the meter itself is not built yet

**The ESP32 and its sensors are on order and have not arrived.** There is no
firmware in this repository: no `.ino`, no `.cpp`, no `platformio.ini`. The
hardware layer described in the README's architecture diagram is a design, not a
built artifact, and nothing in this submission should be read as claiming
otherwise.

Every telemetry figure quoted anywhere in this document was produced by
`backend/scripts/mock_esp32.py` and `backend/tools/backfill_demo_cycle.py`, not by
a physical meter. The 387.7244 kWh demo dataset is seeded synthetic data. The
±accuracy of a real current transformer against a reference meter is **not
measured**, because there is no sensor to measure.

### What was deliberately built to survive the swap

The software was written against the device's **data contract** rather than
against the simulator, so the meter is the only component that changes when the
hardware lands:

- the simulator publishes to the same MQTT topic (`home/+/telemetry`) with the
  same JSON payload the firmware will send;
- `tools/check_telemetry_contract.py` exercises that contract independently of
  who is publishing;
- readings carry the **device's own timestamp**, not arrival time (§3), which is
  the property that makes a real ESP32's offline buffer work at all;
- `energy_wh_delta` is a per-reading delta rather than a cumulative counter, so a
  real meter's counter reset or backfilled gap cannot double-count.

Those decisions are worth more than a rushed firmware sketch would have been.
They are also the reason the swap is a device change and not a rewrite.

### What is still unproven until hardware arrives

Honestly stated, because these are the things a simulator cannot establish:

- **Sensor accuracy.** No calibration constants (VCAL / ICAL / PHASECAL) have been
  derived, and no comparison against a reference meter exists. Any accuracy claim
  about the *measurement* layer would be fabricated.
- **Real electrical behaviour.** The simulator draws voltage, current and power
  factor independently (§3); a real load does not. Nothing here has seen a real
  power factor, a real inrush current, or a real noisy ADC.
- **Firmware-side offline buffering.** The data contract supports it and the
  ingest path is tested against a burst replay (§3), but no device-side
  buffer-and-replay code exists (§10).

### What this means for the submission

The **software system is complete and testable end to end today**, which is what
the AI/Intelligent-Systems primary track is judged on: the forecasting model, the
progressive tariff engine and its inverse, and the budget-constrained allocator
all run against real stored data and are covered by the test suite.

The IoT track is claimed as **supporting**, and the honest scope of that claim is
the ingestion pipeline, the data contract, and the MQTT path — all of which exist
and work — not a fabricated measurement device.

---

## What a judge should take away

The bill prediction beats a strong naive baseline by **+10.75%** on the judged
range, measured by chronological walk-forward on real household data, with the
gate left where it was set and the caveats in §1 attached. The tariff engine is
progressive in both directions and its inverse is verified by round trip. The
recommendation engine's essential-appliance guarantee is enforced in the allocator
and pinned by tests, after being found to be fake.

Three distinct classes of correctness defect were found and fixed during this work,
and all three are written up above with the wrong number printed beside the right
one:

1. **A systemic timezone defect** — "today" computed without a timezone, in four
   independent code paths, including the one under the dashboard's headline number.
   Fixed structurally: one `billing_time` module now owns the question, so those
   components can no longer disagree (§7).
2. **A schema divergence** — three declared tables that had never been created,
   because the database was built from the ORM rather than from the authoritative
   DDL (§5).
3. **A guarantee that was fake** — essential appliances were documented as
   protected and were not protected at all. Now enforced in the allocator, before
   any budget arithmetic runs, and pinned by tests (§4).

Device authentication and device pairing are the significant remaining gaps. They
are §8 and §10 rather than being left for someone to discover.


