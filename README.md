# Smart Energy Meter — IoT + AI

Real-time household electricity monitoring with month-end bill prediction, Egypt
tiered-tariff costing, and budget-aware appliance recommendations.

**Competition track:** IoT (primary) + AI (supporting)

---

## What it does

An ESP32 with current/voltage sensors measures household power draw and publishes
telemetry over MQTT. A FastAPI backend ingests it into PostgreSQL, rolls it up into
hourly and daily aggregates, and uses that history to:

1. **Predict the month-end bill** — a LightGBM model, benchmarked against a naive
   extrapolation baseline with honestly reported error (see *Model performance*).
2. **Cost it in EGP** — a progressive Egyptian residential tariff engine, with an
   inverse function that converts a target bill back into an allowed kWh figure.
3. **Recommend appliance usage** — a greedy allocator that keeps you inside a daily
   budget while never restricting appliances marked essential.

A Next.js dashboard presents live power, the predicted bill with a confidence range,
and the day's recommendations.

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
      aggregation_worker.py  Periodic hourly/daily rollups
  ml/
    training/
      prepare_public_dataset.py   UCI dataset → engineered feature rows
      train_model.py              Chronological validation + acceptance gate
    models/                       Trained model artifact (.pkl)
  db/schema.sql              Reference DDL (mirrors models.py)
  scripts/mock_esp32.py      Telemetry simulator for demos without hardware
  tests/                     pytest suite — tariff, recommendation engine

frontend/
  src/app/                   Next.js App Router pages
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

python create_tables.py       # creates tables from models.py
uvicorn app.main:app --reload # API on :8000, docs at /docs
```

Run the two workers in separate terminals (both need the venv active):

```powershell
python -m app.workers.telemetry_worker     # MQTT → database
python -m app.workers.aggregation_worker   # hourly/daily rollups
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

> **Status: being finalised.** Real measured MAE/MAPE for both the naive baseline
> and the LightGBM model will be recorded here, produced by
> `python -m ml.training.train_model`. No numbers are published in this README
> until they come from an actual validation run.

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

Covers progressive tariff maths (including kWh → EGP → kWh round-trips and bracket
boundaries) and the recommendation engine's budget and essential-appliance
guarantees.
