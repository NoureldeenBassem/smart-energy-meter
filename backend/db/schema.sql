-- ===========================================================================
-- Smart Energy Meter — reference database schema
--
-- SOURCE OF TRUTH: backend/app/models/models.py
--
-- This file is a human-readable mirror of the SQLAlchemy ORM models, kept in
-- sync with them by hand. Tables are actually created by:
--
--     python create_tables.py          (Base.metadata.create_all)
--
-- Keep this file aligned with models.py when models change. If the two ever
-- disagree, models.py wins — it is what actually builds the database.
--
-- Docker note: docker-compose.yml mounts this file into the Postgres
-- container's /docker-entrypoint-initdb.d/, so it runs automatically on a
-- FRESH volume. It must therefore stay valid, executable SQL.
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()


-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    user_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);


-- ---------------------------------------------------------------------------
-- Devices — one row per physical ESP32 meter unit.
--
-- external_id is the string the firmware/simulator publishes in its MQTT
-- payload's "device_id" field (e.g. "esp32_meter_01"). The worker resolves it
-- to the internal UUID primary key.
--
-- pairing_code supports the two-factor device claiming model: claiming a
-- device requires BOTH external_id and pairing_code.
--
-- last_seen_at is the single source of truth for online/offline status,
-- updated by telemetry_worker.py on every successfully ingested packet.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
    device_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    external_id   VARCHAR(100) UNIQUE NOT NULL,
    pairing_code  VARCHAR(20),
    device_label  VARCHAR(100) DEFAULT 'Main Energy Meter',
    last_seen_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_devices_external_id ON devices (external_id);
CREATE INDEX IF NOT EXISTS idx_devices_user_id     ON devices (user_id);


-- ---------------------------------------------------------------------------
-- Raw telemetry — one row per reading published by a device.
--
-- energy_wh_delta is a DELTA, not a cumulative counter: it is the energy used
-- since the previous reading. This is deliberate — deltas survive an ESP32
-- reboot without corrupting totals, whereas a cumulative counter resetting to
-- zero would.
--
-- ts is the reading's REAL timestamp as reported by the device, not its
-- arrival time. received_at records arrival separately, so a late packet
-- (is_backfilled = true) lands in its correct chronological position while
-- still being identifiable as backfilled.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telemetry_raw (
    device_id       UUID NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    ts              TIMESTAMPTZ NOT NULL,
    voltage_rms     REAL,
    current_rms     REAL,
    power_w         REAL,
    power_factor    REAL,
    energy_wh_delta REAL NOT NULL,
    is_backfilled   BOOLEAN NOT NULL DEFAULT FALSE,
    received_at     TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (device_id, ts)
);

CREATE INDEX IF NOT EXISTS idx_telemetry_raw_device_ts
    ON telemetry_raw (device_id, ts DESC);


-- ---------------------------------------------------------------------------
-- Hourly / daily rollups — written by app/workers/aggregation_worker.py using
-- INSERT ... ON CONFLICT DO UPDATE, so re-aggregating a still-filling bucket
-- updates it in place rather than duplicating it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telemetry_hourly (
    device_id        UUID NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    bucket_start     TIMESTAMPTZ NOT NULL,
    total_energy_kwh REAL NOT NULL,
    avg_power_w      REAL,
    peak_power_w     REAL,
    PRIMARY KEY (device_id, bucket_start)
);

CREATE TABLE IF NOT EXISTS telemetry_daily (
    device_id        UUID NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    bucket_start     DATE NOT NULL,
    total_energy_kwh REAL NOT NULL,
    avg_power_w      REAL,
    peak_power_w     REAL,
    PRIMARY KEY (device_id, bucket_start)
);


-- ---------------------------------------------------------------------------
-- Tariff brackets — Egypt residential progressive tariff.
--
-- IMPORTANT: the live tariff calculation does NOT read from this table. The
-- canonical brackets are a Python constant in
-- app/services/tariff_engine/calculator.py (EGYPT_TARIFF_BRACKETS), so the
-- tested logic and the running logic can never drift apart.
--
-- This table exists for auditability and tariff-version history: it records
-- which bracket set applied from which effective_date.
--
-- Pricing model is progressive/marginal — each bracket's rate applies ONLY to
-- the slice of consumption falling inside it, never retroactively to the whole
-- total once a threshold is crossed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tariff_brackets (
    tariff_version_id INT  NOT NULL,
    bracket_order     INT  NOT NULL,
    kwh_from          REAL NOT NULL,
    kwh_to            REAL,             -- NULL = unbounded top bracket
    price_per_kwh     REAL NOT NULL,
    effective_date    DATE NOT NULL,
    PRIMARY KEY (tariff_version_id, bracket_order)
);


-- ---------------------------------------------------------------------------
-- Predicted bills — persisted forecast history, one row per prediction run.
-- Keeping these lets predictions be compared against the eventual actual bill.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bills_predicted (
    prediction_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id            UUID NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    billing_period_start DATE NOT NULL,
    billing_period_end   DATE NOT NULL,
    predicted_kwh        REAL NOT NULL,
    predicted_bill_egp   REAL NOT NULL,
    confidence_low       REAL,
    confidence_high      REAL,
    model_version        VARCHAR(50) NOT NULL,
    generated_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bills_predicted_device
    ON bills_predicted (device_id, generated_at DESC);


-- ---------------------------------------------------------------------------
-- Budgets — the user's monthly spending target in EGP.
-- alert_threshold_pct drives the dashboard's budget warning banner.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS budgets (
    budget_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    target_bill_egp     REAL NOT NULL DEFAULT 500.0,
    alert_threshold_pct INT DEFAULT 85,
    created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budgets_user ON budgets (user_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- Appliances
--
-- Two distinct concepts, deliberately kept separate:
--
--   is_essential — a hard protection flag. An essential appliance is NEVER
--                  restricted by the recommendation engine, in any mode. A
--                  refrigerator must not be shed to save money.
--
--   priority     — soft ordering (High/Medium/Low) among NON-essential
--                  appliances, deciding who gets scarce remaining budget first.
--
-- Conflating these was a real bug: with priority alone, a tight budget could
-- constrain the fridge.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appliances (
    appliance_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    name                VARCHAR(100) NOT NULL,
    rated_power_w       REAL NOT NULL,
    is_essential        BOOLEAN NOT NULL DEFAULT FALSE,
    priority            VARCHAR(20) DEFAULT 'Medium'
                            CHECK (priority IN ('High', 'Medium', 'Low')),
    desired_daily_hours REAL DEFAULT 2.0,
    created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appliances_user ON appliances (user_id);


-- ---------------------------------------------------------------------------
-- Recommendations — persisted output of the greedy allocator, one row per
-- appliance per day, so a past day's plan can be shown as it was given.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recommendations (
    recommendation_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    appliance_id            UUID NOT NULL REFERENCES appliances(appliance_id) ON DELETE CASCADE,
    budget_id               UUID REFERENCES budgets(budget_id) ON DELETE SET NULL,
    plan_date               DATE NOT NULL,
    recommended_daily_hours REAL NOT NULL,
    status                  VARCHAR(20),
    generated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recommendations_lookup
    ON recommendations (user_id, plan_date DESC);


-- ---------------------------------------------------------------------------
-- Seed: Egypt residential tariff, effective 2026-08-01.
-- Mirrors EGYPT_TARIFF_BRACKETS in app/services/tariff_engine/calculator.py.
-- ---------------------------------------------------------------------------
INSERT INTO tariff_brackets
    (tariff_version_id, bracket_order, kwh_from, kwh_to, price_per_kwh, effective_date)
VALUES
    (1, 1,    0,   50, 0.68, '2026-08-01'),
    (1, 2,   50,  100, 0.95, '2026-08-01'),
    (1, 3,  100,  200, 1.15, '2026-08-01'),
    (1, 4,  200,  350, 1.72, '2026-08-01'),
    (1, 5,  350,  650, 2.18, '2026-08-01'),
    (1, 6,  650, 1000, 2.40, '2026-08-01'),
    (1, 7, 1000, NULL, 2.74, '2026-08-01')
ON CONFLICT DO NOTHING;
