# Smart Energy Meter — IoT + AI

Real-time household electricity monitoring with month-end bill prediction, Egypt
tiered-tariff costing, and budget-aware appliance recommendations.

**Competition track:** Intelligent Systems and AI (primary) + Internet of Things (supporting)

> **Hardware status.** The ESP32 and its sensors are on order and not yet in hand,
> so no firmware is in this repository. Everything below runs today against
> `backend/scripts/mock_esp32.py`, which publishes over the same MQTT topic and
> the same JSON contract the real meter will use, so the device is the only
> component that changes when the hardware arrives. See SUBMISSION_STATUS.md §12.

---

## What it does

An ESP32 with current/voltage sensors measures household power draw and publishes
telemetry over MQTT — today that publisher is the simulator, pending hardware. A
FastAPI backend ingests it into PostgreSQL, rolls it up into hourly and daily
aggregates, and uses that history to:

1. **Predict the month-end bill** — a LightGBM model, benchmarked against a naive
   extrapolation baseline with honestly reported error (see *Model performance*).
2. **Cost it in EGP** — a progressive Egyptian residential tariff engine, with an
   inverse function that converts a target bill back into an allowed kWh figure.
3. **Recommend appliance usage** — a greedy allocator that keeps you inside a daily
   budget while never restricting appliances marked essential.

A Next.js frontend presents this as three screens: **Overview** (live power → predicted
bill with its confidence range → what to do about it), **Budget Planner** (a target
bill in, the kWh it allows out), and **Recommendations** (today's per-appliance plan,
with essential appliances shown locked).

---

## Architecture

```
  ESP32 + SCT-013 / ZMPT101B          scripts/mock_esp32.py
  (voltage, current, power)            (simulator, no hardware needed)
              │                                  │
              └──────────► MQTT ◄────────────────┘
                     home/+/telemetry
                            │
                app/workers/telemetry_worker.py
                            │  writes real reading timestamps
                            ▼
                  ┌──────────────────┐
                  │    PostgreSQL    │   telemetry_raw
                  │                  │        │  app/workers/aggregation_worker.py
                  │                  │        ▼  (idempotent upsert rollups)
                  │                  │   telemetry_hourly ──► telemetry_daily
                  └──────────────────┘
                            │
                    FastAPI  /api/v1
        ┌───────────────────┼────────────────────┐
        │                   │                    │
   tariff engine      forecasting          recommendation
   (kWh ⇄ EGP)     (LightGBM + naive)      (greedy allocator)
        └───────────────────┼────────────────────┘
                            ▼
                  Next.js dashboard (:3000)
```

---

## Repository layout

```
backend/
  app/
    main.py                  FastAPI entry — wires all routers under /api/v1
    core/
      database.py            SQLAlchemy engine, session factory, get_db()
      security.py            bcrypt password hashing + JWT issue/verify
    models/models.py         SQLAlchemy ORM models — single source of truth for schema
    api/
      schemas.py             Pydantic request/response contracts
      routes/                auth, devices, telemetry, budgets, appliances,
                             predictions, tariff
    services/
      tariff_engine/         Progressive Egypt tariff: kWh → EGP and EGP → kWh
      forecasting/           Bill prediction service
      recommendation/        Greedy budget-aware appliance allocator
    workers/
      telemetry_worker.py    MQTT subscriber → telemetry_raw
      aggregation_worker.py  Hourly/daily rollups (local-day buckets)
      prediction_snapshot.py Daily bill-forecast snapshots → bills_predicted
  ml/
    training/
      prepare_public_dataset.py   UCI dataset → engineered feature rows
      train_model.py              Chronological validation + acceptance gate
    models/                       Trained model artifact (.pkl)
  db/schema.sql              Authoritative DDL — a SUPERSET of models.py
  scripts/mock_esp32.py      Telemetry simulator for demos without hardware
  tests/                     pytest suite — tariff, recommendation engine,
                             telemetry contract, billing-cycle boundaries

frontend/
  src/app/overview/          Live gauge → predicted bill → budget + plan
  src/app/budget/            Target bill → allowed kWh (via /tariff/allowance)
  src/app/recommendations/   Per-appliance plan; essentials rendered locked
  src/components/            Shell (auth guard + nav), PowerGauge, AlertBanner
  src/lib/                   API client (axios + JWT interceptor)
```

---

## Setup

### 1. Infrastructure

```powershell
cd backend
docker compose up -d          # PostgreSQL on :15432, Mosquitto on :1883
```

### 2. Backend

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

Copy-Item .env.example .env   # then edit .env and set a real SECRET_KEY

# Create the schema. Use schema.sql — it is the authoritative DDL and a superset
# of models.py: it also creates tariff_brackets and recommendations (which have
# no ORM model), plus the DB-level DEFAULT gen_random_uuid() and CHECK
# constraints that SQLAlchemy's create_all does not emit.
# Every statement is IF NOT EXISTS / ON CONFLICT DO NOTHING, so it is safe to
# re-run against an existing database.
Get-Content db\schema.sql -Raw | docker exec -i smart_meter_postgres `
    psql -U smart_meter_user -d smart_meter -v ON_ERROR_STOP=1

uvicorn app.main:app --reload # API on :8000, docs at /docs
```

`python create_tables.py` does the same thing from inside the venv — it applies
`db/schema.sql` and then verifies all ten tables exist. It no longer builds the
schema from `models.py`; doing that produced a database without the DB-level
defaults and CHECK constraints, which `CREATE TABLE IF NOT EXISTS` then made
permanent by skipping those tables on any later repair. Either command is fine.

The API does **not** create tables on startup. It checks the schema and logs which
tables are missing, so a half-built database is reported rather than silently
extended.

> **The venv is machine-specific — never copy it between computers.**
> `venv/pyvenv.cfg` records an absolute path to the Python that created it, so a
> venv copied from a teammate's machine fails with
> `No Python at '...'` and nothing in the project will run. It is gitignored for
> this reason. If you receive this project as a folder rather than a clone, delete
> `backend/venv` and rebuild it with the three commands above — everything needed
> is in `requirements.txt`.

Run the workers in separate terminals (all need the venv active):

```powershell
python -m app.workers.telemetry_worker           # MQTT → database
python -m app.workers.aggregation_worker         # hourly/daily rollups, 60s loop
python -m app.workers.aggregation_worker --once --all   # one-off full rebuild
python -m app.workers.prediction_snapshot        # log today's forecast (run daily)
```

### 3. Frontend

```powershell
cd frontend
npm install
npm run dev                   # dashboard on :3000
```

### 4. Demo without hardware

```powershell
cd backend
python scripts\mock_esp32.py  # publishes realistic telemetry every 5s
```

Register the device first (`POST /api/v1/devices`, or the dashboard's onboarding
flow) — the worker drops packets from any `external_id` it doesn't recognise.

---

## Machine learning pipeline

**Dataset:** UCI *Individual Household Electric Power Consumption* — ~2M
minute-level readings over ~4 years.

Not committed to the repo (~133 MB, over GitHub's 100 MB file limit). Download from
the [UCI ML Repository](https://archive.ics.uci.edu/dataset/235/individual+household+electric+power+consumption)
and place `household_power_consumption.txt` in `backend/ml/data/`.

```powershell
cd backend
python -m ml.training.prepare_public_dataset   # → ml/data/training_rows.csv
python -m ml.training.train_model              # → ml/models/lightgbm_model.pkl
```

**Features:** `cumulative_kwh_so_far`, `day_of_month`, `days_remaining`,
`rolling_avg_daily_kwh_7d`, `day_of_week`, `is_weekend`.

**Validation:** chronological walk-forward — fold *k* trains only on cycles
strictly before cycle *k*. Random shuffling is never used; it would let the model
train on future data to predict the past.

**Acceptance gate:** `train_model.py` refuses to save a model that does not beat
the naive baseline by a required margin. A failing model is reported as failing,
not shipped.

### Model performance

Measured by `python -m ml.training.train_model` on the public UCI dataset
aggregated to daily kWh, chronological walk-forward. Errors are in kWh over a
full billing cycle.

| Range | Naive MAE | Model MAE | Naive MAPE | Model MAPE | Improvement | Cycles beaten |
|---|---|---|---|---|---|---|
| Day 3–30 (5880 preds / 210 folds) | 50.52 | 41.88 | 7.26% | 6.27% | +17.10% | 161/210 (77%) |
| **Day 15–30 — the judged gate** | **26.30** | **23.47** | **3.69%** | **3.42%** | **+10.75%** | **146/210 (70%)** |
| Day 3–14 | 82.81 | 66.42 | 12.02% | 10.07% | +19.79% | 161/210 (77%) |

Day 15–30 is the range the gate is set on, because that is where the naive
baseline is strong and beating it means something. A disjoint-cycle cross-check
gives +11.15% at the same range.

**Three things to read before quoting these numbers:**

- **The margin is real but thin.** +10.75% against a 10.0% minimum, and on the
  disjoint set it wins on only 59% of individual cycles — it wins by larger
  margins on the cycles it wins rather than winning consistently.
- **The demo dashboard is not the accuracy evidence.** On the seeded synthetic
  backfill the model's correction is under 1% of the naive figure, because that
  series is near-stationary and a rolling average is already close to optimal on
  it. The claim rests on the pooled walk-forward result over real household
  variation, not on any number visible on screen.
- **The training data is a French household, not an Egyptian one.** No public
  Egyptian per-household dataset of comparable granularity exists.

Full caveats, including the selection pressure in that figure, are in
[SUBMISSION_STATUS.md](SUBMISSION_STATUS.md).

---

## Honest status

See `SUBMISSION_STATUS.md` for a component-by-component account of what is built
and verified, what is partial, and what is designed but not implemented.

---

## Tests

```powershell
cd backend
.\venv\Scripts\python.exe -m pytest tests/ -v
```

160 tests. Covers progressive tariff maths (kWh → EGP → kWh round-trips and bracket
boundaries), billing-cycle boundaries across 28/29/30/31-day months, the telemetry
data contract, and the recommendation engine's two hard guarantees: an essential
appliance always receives its full runtime in every mode including *away*, and the
plan never exceeds its allowance.
